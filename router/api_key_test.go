package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPIKeyRoutesRequireTheirExpectedAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := New()
	for _, item := range []struct{ method, path string }{{http.MethodGet, "/api/v1/api-keys"}, {http.MethodPost, "/v1/chat/completions"}} {
		req := httptest.NewRequest(item.method, item.path, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s status=%d body=%s", item.path, response.Code, response.Body.String())
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer jwt-looking-value")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("JWT on external route status=%d body=%s", response.Code, response.Body.String())
	}
}
