package service

import (
	"context"
	"encoding/json"
	"math"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

func TestRechargeDefaultsAndValidation(t *testing.T) {
	setting := normalizePublicSetting(model.PublicSetting{}).Recharge
	if setting.Enabled == nil || !*setting.Enabled || setting.StoreURL != defaultRechargeStoreURL || setting.Notice != defaultRechargeNotice || setting.Contact != "" || setting.LargeAmount != 100 {
		t.Fatalf("defaults: %+v", setting)
	}
	for i, want := range []float64{0.1, 1, 5, 10, 20, 30} {
		if setting.Tiers[i].Amount != want {
			t.Fatalf("tier %d: %+v", i, setting.Tiers)
		}
	}
	var disabled model.PublicSetting
	if err := json.Unmarshal([]byte(`{"recharge":{"enabled":false,"tiers":[]}}`), &disabled); err != nil {
		t.Fatal(err)
	}
	setting = normalizePublicSetting(disabled).Recharge
	if *setting.Enabled || len(setting.Tiers) != 0 {
		t.Fatalf("disabled/empty tiers overwritten: %+v", setting)
	}
	for _, link := range []string{"javascript:alert(1)", "data:text/html,bad", "//shop.test", "ftp://shop.test", "https://user:pass@shop.test", "https://"} {
		if err := validateRechargeSetting(model.RechargeSetting{StoreURL: link}); err == nil {
			t.Fatalf("accepted URL %q", link)
		}
		if err := validateRechargeSetting(model.RechargeSetting{Tiers: []model.RechargeTier{{Amount: 1, URL: link}}}); err == nil {
			t.Fatalf("accepted tier URL %q", link)
		}
	}
	for _, link := range []string{"", "http://shop.test/path", "https://shop.test/path?x=1"} {
		if err := validateRechargeSetting(model.RechargeSetting{StoreURL: link}); err != nil {
			t.Fatalf("valid URL %q: %v", link, err)
		}
	}
	for _, amount := range []float64{math.NaN(), math.Inf(1), -1, 0.001, 1000001, 1.005} {
		if err := validateRechargeSetting(model.RechargeSetting{LargeAmount: amount}); err == nil {
			t.Fatalf("accepted threshold %v", amount)
		}
	}
	if got := normalizePricingSetting(model.PricingSetting{CreditRate: 0.000001}).CreditRate; got != 1 {
		t.Fatalf("invalid normalized rate %v", got)
	}
}

// All DB tests use this freshly created temporary SQLite database, never a configured/live DB.
func TestRedeemIntegration(t *testing.T) {
	oldConfig := config.Cfg
	config.Cfg.StorageDriver = "sqlite"
	config.Cfg.DatabaseDSN = filepath.Join(t.TempDir(), "isolated-redeem.db") + "?_pragma=busy_timeout(10000)"
	config.Cfg.JWTSecret = "isolated-redeem-test-secret"
	t.Cleanup(func() { config.Cfg = oldConfig })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(12)
	t.Cleanup(func() { _ = sqlDB.Close() })
	admin := model.User{ID: "redeem-admin", Username: "redeem-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	alice := model.User{ID: "redeem-alice", Username: "redeem-alice", DisplayName: "Alice", Role: model.UserRoleUser, Status: model.UserStatusActive, Credits: 5}
	bob := model.User{ID: "redeem-bob", Username: "redeem-bob", Role: model.UserRoleUser, Status: model.UserStatusActive}
	banned := model.User{ID: "redeem-banned", Username: "redeem-banned", Role: model.UserRoleUser, Status: model.UserStatusBan}
	if err := db.Create(&[]model.User{admin, alice, bob, banned}).Error; err != nil {
		t.Fatal(err)
	}
	adminCtx := WithUser(context.Background(), model.PublicUser(admin))
	aliceCtx := WithUser(context.Background(), model.PublicUser(alice))
	bobCtx := WithUser(context.Background(), model.PublicUser(bob))
	settings := normalizeSettings(model.Settings{})
	settings.Public.ModelChannel.Pricing.CreditRate = 0.3
	if _, err := repository.SaveSettings(settings, now()); err != nil {
		t.Fatal(err)
	}
	create := func(amount float64, count int) []model.RedeemCode {
		t.Helper()
		result, err := CreateRedeemCodes(adminCtx, CreateRedeemCodesRequest{Amount: amount, Count: count, Remark: "internal-only"})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Items) != count || result.Total != count {
			t.Fatalf("batch result: %+v", result)
		}
		return result.Items
	}
	loadUser := func(id string) model.User {
		t.Helper()
		var user model.User
		if err := db.Where("id = ?", id).First(&user).Error; err != nil {
			t.Fatal(err)
		}
		return user
	}
	loadCode := func(id string) model.RedeemCode {
		t.Helper()
		var code model.RedeemCode
		if err := db.Where("id = ?", id).First(&code).Error; err != nil {
			t.Fatal(err)
		}
		return code
	}
	countLogs := func(id string) int64 {
		t.Helper()
		var total int64
		if err := db.Model(&model.CreditLog{}).Where("related_id = ?", id).Count(&total).Error; err != nil {
			t.Fatal(err)
		}
		return total
	}

	t.Run("validation and authorization", func(t *testing.T) {
		for _, amount := range []float64{math.NaN(), math.Inf(1), math.Inf(-1), -1, 0, 0.001, 1.001, 1000001} {
			if _, err := CreateRedeemCodes(adminCtx, CreateRedeemCodesRequest{Amount: amount, Count: 1}); err == nil {
				t.Fatalf("accepted amount %v", amount)
			}
		}
		for _, count := range []int{-1, 0, 501, 10000000} {
			if _, err := CreateRedeemCodes(adminCtx, CreateRedeemCodesRequest{Amount: 1, Count: count}); err == nil {
				t.Fatalf("accepted count %d", count)
			}
		}
		for _, expires := range []string{"yesterday", time.Now().Add(-time.Hour).Format(time.RFC3339)} {
			if _, err := CreateRedeemCodes(adminCtx, CreateRedeemCodesRequest{Amount: 1, Count: 1, ExpiresAt: expires}); err == nil {
				t.Fatalf("accepted expires %s", expires)
			}
		}
		for _, ctx := range []context.Context{context.Background(), aliceCtx, WithUser(context.Background(), model.AuthUser{ID: "guest", Role: model.UserRoleGuest})} {
			if _, err := CreateRedeemCodes(ctx, CreateRedeemCodesRequest{Amount: 1, Count: 1}); err == nil {
				t.Fatal("unauthorized create")
			}
			if _, err := ListRedeemCodes(ctx, model.Query{}); err == nil {
				t.Fatal("unauthorized list")
			}
			if err := VoidRedeemCode(ctx, "id"); err == nil {
				t.Fatal("unauthorized void")
			}
		}
		if _, err := Redeem(context.Background(), "code"); err == nil {
			t.Fatal("unauthenticated redeem")
		}
		if _, err := ListRedeemRecords(context.Background(), model.Query{}); err == nil {
			t.Fatal("unauthenticated history")
		}
	})
	t.Run("entropy, precision and fixed credits", func(t *testing.T) {
		items := create(1, 100)
		seen := map[string]bool{}
		for _, item := range items {
			if len(item.Code) != 49 || seen[item.Code] || item.Credits != 3.3333 || item.Batch != items[0].Batch {
				t.Fatalf("bad generated item: %+v", item)
			}
			seen[item.Code] = true
		}
		settings.Public.ModelChannel.Pricing.CreditRate = 1
		if _, err := repository.SaveSettings(settings, now()); err != nil {
			t.Fatal(err)
		}
		result, err := Redeem(aliceCtx, "  "+strings.ToLower(items[0].Code)+"  ")
		if err != nil {
			t.Fatal(err)
		}
		if result.Credits != 3.3333 || result.Amount != 1 || result.User.Credits != 8.3333 {
			t.Fatalf("result: %+v", result)
		}
		if _, err := Redeem(bobCtx, items[0].Code); err == nil {
			t.Fatal("second redeem succeeded")
		}
		if countLogs(items[0].ID) != 1 || loadCode(items[0].ID).UsedBy != alice.ID {
			t.Fatal("missing unique accounting")
		}
		if err := VoidRedeemCode(adminCtx, items[0].ID); err == nil {
			t.Fatal("voided used code")
		}
	})
	t.Run("invalid expired and void do not credit", func(t *testing.T) {
		items := create(0.1, 3)
		if err := VoidRedeemCode(adminCtx, items[0].ID); err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.RedeemCode{}).Where("id = ?", items[1].ID).Update("expires_at", time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)).Error; err != nil {
			t.Fatal(err)
		}
		before := loadUser(alice.ID).Credits
		for _, code := range []string{"", "x", "R" + strings.Repeat("Z", 48), "R" + strings.Repeat("0", 48), items[0].Code, items[1].Code} {
			if _, err := Redeem(aliceCtx, code); err == nil {
				t.Fatalf("accepted invalid code %q", code)
			}
		}
		if loadUser(alice.ID).Credits != before || countLogs(items[0].ID) != 0 || countLogs(items[1].ID) != 0 {
			t.Fatal("invalid redeem changed balance/log")
		}
		list, err := ListRedeemCodes(adminCtx, model.Query{Type: "expired", Keyword: items[1].Code})
		if err != nil || list.Total != 1 || list.Items[0].Status != model.RedeemCodeExpired {
			t.Fatalf("expired list: %+v, %v", list, err)
		}
		unused, err := ListRedeemCodes(adminCtx, model.Query{Type: "unused", Keyword: items[1].Code})
		if err != nil || unused.Total != 0 {
			t.Fatalf("expired still unused: %+v %v", unused, err)
		}
		if err := VoidRedeemCode(adminCtx, items[1].ID); err == nil {
			t.Fatal("voided expired")
		}
	})
	t.Run("concurrent claim exactly once", func(t *testing.T) {
		item := create(0.1, 1)[0]
		beforeA, beforeB := loadUser(alice.ID).Credits, loadUser(bob.ID).Credits
		start := make(chan struct{})
		results := make(chan error, 32)
		var wg sync.WaitGroup
		for i := 0; i < 32; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				ctx := aliceCtx
				if i%2 != 0 {
					ctx = bobCtx
				}
				_, err := Redeem(ctx, item.Code)
				results <- err
			}(i)
		}
		close(start)
		wg.Wait()
		close(results)
		succeeded := 0
		for err := range results {
			if err == nil {
				succeeded++
			}
		}
		if succeeded != 1 || countLogs(item.ID) != 1 {
			t.Fatalf("successes=%d logs=%d", succeeded, countLogs(item.ID))
		}
		delta := normalizeCredits(loadUser(alice.ID).Credits - beforeA + loadUser(bob.ID).Credits - beforeB)
		if delta != 0.1 {
			t.Fatalf("credited %v", delta)
		}
	})
	t.Run("rollback on log failure and unavailable user", func(t *testing.T) {
		item := create(2, 1)[0]
		before := loadUser(alice.ID).Credits
		if err := db.Callback().Create().Before("gorm:create").Register("redeem_test_fail_log", func(tx *gorm.DB) {
			if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "credit_logs" {
				tx.AddError(context.Canceled)
			}
		}); err != nil {
			t.Fatal(err)
		}
		_, redeemErr := Redeem(aliceCtx, item.Code)
		_ = db.Callback().Create().Remove("redeem_test_fail_log")
		if redeemErr == nil || loadUser(alice.ID).Credits != before || loadCode(item.ID).Status != model.RedeemCodeUnused || countLogs(item.ID) != 0 {
			t.Fatal("transaction did not rollback")
		}
		for _, user := range []model.User{banned, {ID: "missing", Role: model.UserRoleUser}} {
			if _, err := Redeem(WithUser(context.Background(), model.PublicUser(user)), item.Code); err == nil {
				t.Fatal("unavailable user redeemed")
			}
			if loadCode(item.ID).Status != model.RedeemCodeUnused || countLogs(item.ID) != 0 {
				t.Fatal("user failure did not rollback")
			}
		}
		if _, err := Redeem(aliceCtx, item.Code); err != nil {
			t.Fatalf("retry after rollback: %v", err)
		}
	})
	t.Run("own masked history and admin filters", func(t *testing.T) {
		item := create(3, 1)[0]
		if _, err := Redeem(bobCtx, item.Code); err != nil {
			t.Fatal(err)
		}
		list, err := ListRedeemRecords(aliceCtx, model.Query{PageSize: 500, Keyword: item.Code})
		if err != nil || list.Total == 0 {
			t.Fatalf("history: %+v %v", list, err)
		}
		for _, record := range list.Items {
			if record.ID == item.ID || !strings.Contains(record.Code, "****") || len(record.Code) != 12 {
				t.Fatalf("leaked history: %+v", record)
			}
		}
		payload, _ := json.Marshal(list)
		for _, secret := range []string{"internal-only", "usedBy", "userDisplayName", item.Code} {
			if strings.Contains(string(payload), secret) {
				t.Fatalf("history contains %q", secret)
			}
		}
		adminList, err := ListRedeemCodes(adminCtx, model.Query{Type: "used", Keyword: item.Code, PageSize: 1})
		if err != nil || adminList.Total != 1 || len(adminList.Items) != 1 || adminList.Items[0].UsedBy != bob.ID || adminList.Items[0].UserDisplayName != bob.Username {
			t.Fatalf("admin list: %+v %v", adminList, err)
		}
	})
	t.Run("multiple codes credit one user without lost updates", func(t *testing.T) {
		items := create(0.1, 20)
		before := loadUser(alice.ID).Credits
		start := make(chan struct{})
		results := make(chan error, len(items))
		var wg sync.WaitGroup
		for _, item := range items {
			wg.Add(1)
			go func(code string) { defer wg.Done(); <-start; _, err := Redeem(aliceCtx, code); results <- err }(item.Code)
		}
		close(start)
		wg.Wait()
		close(results)
		for err := range results {
			if err != nil {
				t.Fatalf("concurrent distinct code: %v", err)
			}
		}
		if delta := normalizeCredits(loadUser(alice.ID).Credits - before); delta != 2 {
			t.Fatalf("lost update: %v", delta)
		}
		for _, item := range items {
			if countLogs(item.ID) != 1 {
				t.Fatalf("missing ledger for %s", item.ID)
			}
		}
	})
	t.Run("rate validation and zero-credit conversion rejected", func(t *testing.T) {
		for _, rate := range []float64{math.NaN(), math.Inf(1), -1} {
			invalid := settings
			invalid.Public.ModelChannel.Pricing.CreditRate = rate
			if _, err := SaveSettings(invalid); err == nil {
				t.Fatalf("accepted rate %v", rate)
			}
		}
		tooSmall := settings
		tooSmall.Public.ModelChannel.Pricing.CreditRate = 1000
		if _, err := repository.SaveSettings(tooSmall, now()); err != nil {
			t.Fatal(err)
		}
		if _, err := CreateRedeemCodes(adminCtx, CreateRedeemCodesRequest{Amount: 0.01, Count: 1}); err == nil {
			t.Fatal("generated zero-credit code")
		}
		if _, err := repository.SaveSettings(settings, now()); err != nil {
			t.Fatal(err)
		}
		invalidURL := settings
		invalidURL.Public.Recharge.StoreURL = "javascript:alert(1)"
		if _, err := SaveSettings(invalidURL); err == nil {
			t.Fatal("persisted unsafe URL")
		}
	})
	t.Run("batch insert is atomic on a duplicate", func(t *testing.T) {
		item := create(1, 1)[0]
		fresh := item
		fresh.ID = "duplicate-batch-fresh"
		fresh.Code = "R" + strings.Repeat("F", 48)
		if err := repository.CreateRedeemCodes([]model.RedeemCode{fresh, item}); err == nil {
			t.Fatal("duplicate batch accepted")
		}
		var count int64
		if err := db.Model(&model.RedeemCode{}).Where("id = ?", fresh.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatal("partial batch committed")
		}
	})
	t.Run("RFC3339 offsets normalized and disabled preserved", func(t *testing.T) {
		expires := time.Now().Add(24 * time.Hour).In(time.FixedZone("UTC+8", 8*3600)).Format(time.RFC3339)
		result, err := CreateRedeemCodes(adminCtx, CreateRedeemCodesRequest{Amount: 1, Count: 1, ExpiresAt: expires})
		if err != nil || !strings.HasSuffix(result.Items[0].ExpiresAt, "Z") {
			t.Fatalf("expiry: %+v %v", result, err)
		}
		disabled := false
		settings.Public.Recharge.Enabled = &disabled
		if _, err := repository.SaveSettings(settings, now()); err != nil {
			t.Fatal(err)
		}
		loaded, err := PublicSettings()
		if err != nil || *loaded.Recharge.Enabled {
			t.Fatalf("disabled reset: %+v %v", loaded.Recharge, err)
		}
	})
}
