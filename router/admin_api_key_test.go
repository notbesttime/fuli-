package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAdminAPIKeyRoutesRequireAdminAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := New()
	for _, item := range []struct{ method, path string }{
		{http.MethodGet, "/api/admin/api-keys"},
		{http.MethodPost, "/api/admin/api-keys/k1"},
		{http.MethodPost, "/api/admin/api-keys/k1/status"},
		{http.MethodDelete, "/api/admin/api-keys/k1"},
	} {
		req := httptest.NewRequest(item.method, item.path, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s status=%d body=%s", item.method, item.path, response.Code, response.Body.String())
		}
	}
}
