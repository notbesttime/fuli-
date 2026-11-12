package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

func UserAPIKeys(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		FailWithStatus(w, http.StatusUnauthorized, "未登录或权限不足")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	items, err := service.ListAPIKeys(user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, struct {
		Items any `json:"items"`
	}{Items: items})
}

func CreateUserAPIKey(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		FailWithStatus(w, http.StatusUnauthorized, "未登录或权限不足")
		return
	}
	var input struct {
		Name  string `json:"name"`
		Group string `json:"group"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&input); err != nil {
		Fail(w, "请求参数无效")
		return
	}
	created, err := service.CreateAPIKey(user.ID, input.Name, input.Group)
	if err != nil {
		FailError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	OK(w, created)
}

func RevokeUserAPIKey(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		FailWithStatus(w, http.StatusUnauthorized, "未登录或权限不足")
		return
	}
	if err := service.RevokeAPIKey(id, user.ID); err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]bool{"revoked": true})
}
