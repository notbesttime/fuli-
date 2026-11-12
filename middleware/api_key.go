package middleware

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/handler"
	"github.com/tigerowo/infinite-canvas/service"
)

func APIKeyAuth(c *gin.Context) {
	scheme, secret, ok := strings.Cut(c.GetHeader("Authorization"), " ")
	secret = strings.TrimSpace(secret)
	if !ok || !strings.EqualFold(scheme, "Bearer") || secret == "" || strings.ContainsAny(secret, " \t\r\n") {
		handler.FailWithStatus(c.Writer, http.StatusUnauthorized, "无效的 API 密钥")
		c.Abort()
		return
	}
	user, err := service.AuthenticateAPIKey(secret)
	if errors.Is(err, service.ErrInvalidAPIKey) {
		handler.FailWithStatus(c.Writer, http.StatusUnauthorized, "无效的 API 密钥")
		c.Abort()
		return
	}
	if err != nil {
		log.Printf("API key authentication failed: %v", err)
		handler.FailWithStatus(c.Writer, http.StatusInternalServerError, "认证服务暂不可用")
		c.Abort()
		return
	}
	c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	c.Next()
}
