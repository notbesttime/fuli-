package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

func AdminAPIKeys(w http.ResponseWriter, r *http.Request) {
	list, err := service.ListAdminAPIKeys(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, list)
}

func AdminSaveAPIKey(w http.ResponseWriter, r *http.Request, id string) {
	var input service.AdminAPIKeyInput
	_ = json.NewDecoder(r.Body).Decode(&input)
	key, err := service.SaveAdminAPIKey(id, input)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, key)
}

type setAPIKeyStatusRequest struct {
	Active *bool `json:"active"`
}

func AdminSetAPIKeyStatus(w http.ResponseWriter, r *http.Request, id string) {
	var request setAPIKeyStatusRequest
	_ = json.NewDecoder(r.Body).Decode(&request)
	active := false
	if request.Active != nil {
		active = *request.Active
	}
	key, err := service.SetAdminAPIKeyActive(id, active)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, key)
}

func AdminDeleteAPIKey(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteAdminAPIKey(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
