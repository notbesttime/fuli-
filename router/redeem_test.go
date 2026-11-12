package router

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestRedeemRoutes(t *testing.T) {
	oldConfig := config.Cfg
	config.Cfg.StorageDriver = "sqlite"
	config.Cfg.DatabaseDSN = filepath.Join(t.TempDir(), "isolated-redeem-http.db") + "?_pragma=busy_timeout(10000)"
	config.Cfg.JWTSecret = "isolated-redeem-http-secret"
	t.Cleanup(func() { config.Cfg = oldConfig })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	admin := model.User{ID: "http-admin", Username: "http-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	alice := model.User{ID: "http-alice", Username: "http-alice", Role: model.UserRoleUser, Status: model.UserStatusActive}
	bob := model.User{ID: "http-bob", Username: "http-bob", Role: model.UserRoleUser, Status: model.UserStatusActive}
	guest := model.User{ID: "http-guest", Username: "http-guest", Role: model.UserRoleGuest, Status: model.UserStatusActive}
	banned := model.User{ID: "http-banned", Username: "http-banned", Role: model.UserRoleUser, Status: model.UserStatusBan}
	if err := db.Create(&[]model.User{admin, alice, bob, guest, banned}).Error; err != nil {
		t.Fatal(err)
	}
	token := func(user model.User) string {
		t.Helper()
		claims := service.TokenClaims{UserID: user.ID, Username: user.Username, Role: user.Role, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}
		value, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.Cfg.JWTSecret))
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	adminToken, aliceToken, bobToken := token(admin), token(alice), token(bob)
	gin.SetMode(gin.TestMode)
	router := New()
	type envelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
		Msg  string          `json:"msg"`
	}
	request := func(method, path, body, token string, status, resultCode int) envelope {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		var result envelope
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatalf("%s %s body=%s: %v", method, path, response.Body, err)
		}
		if response.Code != status || result.Code != resultCode || result.Msg == "" {
			t.Fatalf("%s %s status=%d response=%s", method, path, response.Code, response.Body)
		}
		return result
	}
	for _, auth := range []string{"", "bad-token", token(guest), token(banned)} {
		request("POST", "/api/v1/redeem", `{"code":"x"}`, auth, 401, 1)
		request("GET", "/api/v1/redeem-records", "", auth, 401, 1)
	}
	for _, auth := range []string{"", aliceToken, token(guest)} {
		request("GET", "/api/admin/redeem-codes", "", auth, 401, 1)
		request("POST", "/api/admin/redeem-codes", `{"amount":1,"count":1}`, auth, 401, 1)
		request("POST", "/api/admin/redeem-codes/x/void", "", auth, 401, 1)
	}
	settingsResp := request("GET", "/api/settings", "", "", 200, 0)
	var settings model.PublicSetting
	if err := json.Unmarshal(settingsResp.Data, &settings); err != nil {
		t.Fatal(err)
	}
	if settings.Recharge.Enabled == nil || !*settings.Recharge.Enabled || settings.Recharge.StoreURL != "https://wzyp.cn/shop/QKH7GGGF" || len(settings.Recharge.Tiers) != 6 {
		t.Fatalf("settings: %+v", settings.Recharge)
	}
	created := request("POST", "/api/admin/redeem-codes", `{"amount":0.1,"count":3,"remark":"http-internal-secret"}`, adminToken, 200, 0)
	var codes model.RedeemCodeList
	if err := json.Unmarshal(created.Data, &codes); err != nil {
		t.Fatal(err)
	}
	if codes.Total != 3 || len(codes.Items) != 3 {
		t.Fatalf("codes %+v", codes)
	}
	for _, item := range codes.Items {
		if item.Status != model.RedeemCodeUnused || item.Batch == "" || item.ID == "" || item.CreatedAt == "" || item.Credits != 0.1 {
			t.Fatalf("code %+v", item)
		}
	}
	redeemed := request("POST", "/api/v1/redeem", fmt.Sprintf(`{"code":%q}`, codes.Items[0].Code), aliceToken, 200, 0)
	var result service.RedeemResult
	if err := json.Unmarshal(redeemed.Data, &result); err != nil {
		t.Fatal(err)
	}
	if result.User.ID != alice.ID || result.User.Credits != 0.1 || result.Credits != 0.1 || result.Amount != 0.1 {
		t.Fatalf("result %+v", result)
	}
	request("POST", "/api/v1/redeem", fmt.Sprintf(`{"code":%q}`, codes.Items[0].Code), bobToken, 200, 1)
	request("POST", "/api/v1/redeem", `{"code":"not-valid"}`, aliceToken, 200, 1)
	request("POST", "/api/v1/redeem", `{"code":2}`, aliceToken, 200, 1)
	request("POST", "/api/admin/redeem-codes", `{"amount":1,"count":501}`, adminToken, 200, 1)
	request("POST", "/api/admin/redeem-codes", `{"amount":1,"count":1,"expiresAt":"bad"}`, adminToken, 200, 1)
	voided := request("POST", "/api/admin/redeem-codes/"+codes.Items[1].ID+"/void", "", adminToken, 200, 0)
	if string(voided.Data) != "true" {
		t.Fatalf("void payload %s", voided.Data)
	}
	request("POST", "/api/v1/redeem", fmt.Sprintf(`{"code":%q}`, codes.Items[1].Code), aliceToken, 200, 1)
	request("POST", "/api/admin/redeem-codes/"+codes.Items[0].ID+"/void", "", adminToken, 200, 1)
	listed := request("GET", "/api/admin/redeem-codes?page=1&pageSize=1&type=used&keyword="+codes.Items[0].Code, "", adminToken, 200, 0)
	var list model.RedeemCodeList
	if err := json.Unmarshal(listed.Data, &list); err != nil {
		t.Fatal(err)
	}
	if list.Total != 1 || len(list.Items) != 1 || list.Items[0].UsedBy != alice.ID || list.Items[0].UserDisplayName != alice.Username {
		t.Fatalf("admin list %+v", list)
	}
	request("GET", "/api/admin/redeem-codes?type=unknown", "", adminToken, 200, 1)
	historyResp := request("GET", "/api/v1/redeem-records", "", aliceToken, 200, 0)
	var history model.RedeemRecordList
	if err := json.Unmarshal(historyResp.Data, &history); err != nil {
		t.Fatal(err)
	}
	if history.Total != 1 || len(history.Items) != 1 || !strings.Contains(history.Items[0].Code, "****") || strings.Contains(string(historyResp.Data), codes.Items[0].Code) || strings.Contains(string(historyResp.Data), "http-internal-secret") {
		t.Fatalf("history %s", historyResp.Data)
	}
	bobHistory := request("GET", "/api/v1/redeem-records?userId="+alice.ID, "", bobToken, 200, 0)
	if err := json.Unmarshal(bobHistory.Data, &history); err != nil {
		t.Fatal(err)
	}
	if history.Total != 0 || len(history.Items) != 0 {
		t.Fatalf("other user history %s", bobHistory.Data)
	}
}
