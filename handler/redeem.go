package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

func AdminRedeemCodes(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListRedeemCodes(r.Context(), parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminCreateRedeemCodes(w http.ResponseWriter, r *http.Request) {
	var req service.CreateRedeemCodesRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&req); err != nil {
		Fail(w, "请求参数无效")
		return
	}
	result, err := service.CreateRedeemCodes(r.Context(), req)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminVoidRedeemCode(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.VoidRedeemCode(r.Context(), id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

func Redeem(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req); err != nil {
		Fail(w, "请求参数无效")
		return
	}
	result, err := service.Redeem(r.Context(), req.Code)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func RedeemRecords(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListRedeemRecords(r.Context(), parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
