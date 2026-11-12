package repository

import (
	"path/filepath"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

func TestAPIKeyPersistenceAndOwnerScopedRevoke(t *testing.T) {
	old := config.Cfg
	config.Cfg.StorageDriver = "sqlite"
	config.Cfg.DatabaseDSN = filepath.Join(t.TempDir(), "api-keys.db") + "?_pragma=busy_timeout(10000)"
	t.Cleanup(func() { config.Cfg = old })
	db, err := DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	key := model.APIKey{ID: "api-key-test", UserID: "user-a", Name: "test", KeyHash: "hash-test", Prefix: "sk-fuli-abcd", Group: "premium", Active: true, CreatedAt: "2026-01-01T00:00:00Z"}
	if err := CreateAPIKey(key); err != nil {
		t.Fatal(err)
	}
	got, ok, err := GetActiveAPIKeyByHash(key.KeyHash)
	if err != nil || !ok {
		t.Fatalf("active key lookup: ok=%v err=%v", ok, err)
	}
	if got.UserID != key.UserID || got.Group != key.Group {
		t.Fatalf("loaded key=%+v", got)
	}
	if revoked, err := RevokeUserAPIKey(key.ID, "user-b"); err != nil || revoked {
		t.Fatalf("foreign owner revoke: revoked=%v err=%v", revoked, err)
	}
	if revoked, err := RevokeUserAPIKey(key.ID, "user-a"); err != nil || !revoked {
		t.Fatalf("owner revoke: revoked=%v err=%v", revoked, err)
	}
	if _, ok, err := GetActiveAPIKeyByHash(key.KeyHash); err != nil || ok {
		t.Fatalf("revoked key lookup: ok=%v err=%v", ok, err)
	}
	items, err := ListUserAPIKeys("user-a")
	if err != nil || len(items) != 1 || items[0].Active {
		t.Fatalf("revoked key list=%+v err=%v", items, err)
	}
}
