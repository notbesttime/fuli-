package service

import (
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestSetUserStatusRejectsInvalidStatus(t *testing.T) {
	if _, err := SetUserStatus("any-id", model.UserStatus("bogus")); err == nil {
		t.Fatal("expected error for invalid user status")
	}
}

func TestAPIKeyExpired(t *testing.T) {
	if apiKeyExpired("") {
		t.Fatal("empty expiry should never be expired")
	}
	if apiKeyExpired("not-a-time") {
		t.Fatal("unparsable expiry should be treated as never expired")
	}
	if !apiKeyExpired("2000-01-01T00:00:00Z") {
		t.Fatal("past expiry should be expired")
	}
	if apiKeyExpired("2999-01-01T00:00:00Z") {
		t.Fatal("future expiry should not be expired")
	}
}
