package repository

import (
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestListAdminAPIKeysFiltersAndJoinsUser(t *testing.T) {
	resetTestDB(t, "admin-api-keys.db")
	users := []model.User{
		{ID: "au1", Username: "alice", DisplayName: "Alice", Role: model.UserRoleUser, Status: model.UserStatusActive, Group: "vip", CreatedAt: "2026-01-01T00:00:00Z"},
		{ID: "au2", Username: "bob", DisplayName: "Bob", Role: model.UserRoleUser, Status: model.UserStatusActive, Group: "default", CreatedAt: "2026-01-02T00:00:00Z"},
	}
	for _, u := range users {
		if _, err := SaveUser(u); err != nil {
			t.Fatalf("seed user %s: %v", u.Username, err)
		}
	}
	keys := []model.APIKey{
		{ID: "k1", UserID: "au1", Name: "alice-vip", KeyHash: "h1", Prefix: "sk-aaaa", Group: "vip", Active: true, ExpiresAt: "2030-01-01T00:00:00Z", CreatedAt: "2026-01-01T00:00:00Z"},
		{ID: "k2", UserID: "au2", Name: "bob-default", KeyHash: "h2", Prefix: "sk-bbbb", Group: "default", Active: false, CreatedAt: "2026-01-02T00:00:00Z"},
		{ID: "k3", UserID: "au1", Name: "alice-vip-2", KeyHash: "h3", Prefix: "sk-cccc", Group: "vip", Active: true, CreatedAt: "2026-01-03T00:00:00Z"},
	}
	for _, k := range keys {
		if err := CreateAPIKey(k); err != nil {
			t.Fatalf("seed key %s: %v", k.ID, err)
		}
	}
	// Active 字段带 default:true，Create 传 false 会被默认值覆盖；禁用走 Updates，故先建后改。
	if err := UpdateAdminAPIKey("k2", map[string]any{"active": false}); err != nil {
		t.Fatalf("disable k2: %v", err)
	}

	items, total, err := ListAdminAPIKeys(model.Query{Group: "vip"})
	if err != nil || total != 2 || len(items) != 2 {
		t.Fatalf("group filter total=%d len=%d err=%v", total, len(items), err)
	}

	_, total, err = ListAdminAPIKeys(model.Query{Status: "active"})
	if err != nil || total != 2 {
		t.Fatalf("active filter total=%d err=%v", total, err)
	}
	_, total, err = ListAdminAPIKeys(model.Query{Status: "disabled"})
	if err != nil || total != 1 {
		t.Fatalf("disabled filter total=%d err=%v", total, err)
	}

	items, total, err = ListAdminAPIKeys(model.Query{Keyword: "Alice"})
	if err != nil || total != 2 {
		t.Fatalf("keyword user filter total=%d err=%v", total, err)
	}
	if len(items) == 0 || items[0].UserDisplayName == "" || items[0].Username == "" {
		t.Fatalf("join missing user info: %+v", items)
	}

	single, ok, err := GetAdminAPIKey("k1")
	if err != nil || !ok || single.UserDisplayName != "Alice" || single.Group != "vip" {
		t.Fatalf("get admin key single=%+v ok=%v err=%v", single, ok, err)
	}
}
