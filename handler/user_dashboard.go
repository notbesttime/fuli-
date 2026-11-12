package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func UserCreditLogs(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	page, err := queryInt(query.Get("page"), 1)
	if err != nil {
		Fail(w, "page 参数无效")
		return
	}
	pageSize, err := queryInt(query.Get("pageSize"), 10)
	if err != nil {
		Fail(w, "pageSize 参数无效")
		return
	}
	earnedOnly := false
	if value := query.Get("earnedOnly"); value != "" {
		earnedOnly, err = strconv.ParseBool(value)
		if err != nil {
			Fail(w, "earnedOnly 参数无效")
			return
		}
	}
	result, err := service.ListUserCreditLogs(r.Context(), model.Query{Page: page, PageSize: pageSize}, earnedOnly)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func UserDashboardOverview(w http.ResponseWriter, r *http.Request) {
	result, err := service.DashboardOverview(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func UserPreferences(w http.ResponseWriter, r *http.Request) {
	result, err := service.UserPreferences(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func UpdateUserPreferences(w http.ResponseWriter, r *http.Request) {
	var preferences model.UserPreferences
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&preferences); err != nil {
		Fail(w, "请求参数无效")
		return
	}
	result, err := service.SaveUserPreferences(r.Context(), preferences)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func queryInt(value string, fallback int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	return strconv.Atoi(value)
}
