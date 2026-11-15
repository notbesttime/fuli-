package repository

import (
	"path/filepath"
	"sync"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

// resetTestDB 强制用独立临时库重跑初始化，避免与同包其它 DB 测试共享 dbOnce。
func resetTestDB(t *testing.T, name string) {
	t.Helper()
	old := config.Cfg
	config.Cfg.StorageDriver = "sqlite"
	config.Cfg.DatabaseDSN = filepath.Join(t.TempDir(), name) + "?_pragma=busy_timeout(10000)"
	db, dbErr = nil, nil
	dbOnce = sync.Once{}
	t.Cleanup(func() {
		if db != nil {
			if sqlDB, err := db.DB(); err == nil {
				_ = sqlDB.Close()
			}
		}
		db, dbErr = nil, nil
		dbOnce = sync.Once{}
		config.Cfg = old
	})
	if _, err := DB(); err != nil {
		t.Fatalf("init test db: %v", err)
	}
}

func TestListUsersFiltersAndSorts(t *testing.T) {
	resetTestDB(t, "users.db")
	seed := []model.User{
		{ID: "u1", Username: "alice", Role: model.UserRoleAdmin, Status: model.UserStatusActive, Group: "default", Credits: 10, CreatedAt: "2026-01-01T00:00:00Z"},
		{ID: "u2", Username: "bob", Role: model.UserRoleUser, Status: model.UserStatusBan, Group: "vip", Credits: 30, CreatedAt: "2026-01-02T00:00:00Z"},
		{ID: "u3", Username: "carol", Role: model.UserRoleUser, Status: model.UserStatusActive, Group: "vip", Credits: 20, CreatedAt: "2026-01-03T00:00:00Z"},
	}
	for _, user := range seed {
		if _, err := SaveUser(user); err != nil {
			t.Fatalf("seed %s: %v", user.Username, err)
		}
	}

	users, total, err := ListUsers(model.Query{Group: "vip"})
	if err != nil || total != 2 || len(users) != 2 {
		t.Fatalf("group filter total=%d len=%d err=%v", total, len(users), err)
	}

	users, total, err = ListUsers(model.Query{Role: string(model.UserRoleAdmin)})
	if err != nil || total != 1 || len(users) != 1 || users[0].Username != "alice" {
		t.Fatalf("role filter users=%+v total=%d err=%v", users, total, err)
	}

	_, total, err = ListUsers(model.Query{Status: string(model.UserStatusActive)})
	if err != nil || total != 2 {
		t.Fatalf("status filter total=%d err=%v", total, err)
	}

	users, total, err = ListUsers(model.Query{Keyword: "carol", Status: string(model.UserStatusActive)})
	if err != nil || total != 1 || len(users) != 1 || users[0].Username != "carol" {
		t.Fatalf("keyword+status users=%+v total=%d err=%v", users, total, err)
	}

	users, _, err = ListUsers(model.Query{SortBy: "credits", SortOrder: "asc"})
	if err != nil || len(users) != 3 || users[0].Username != "alice" || users[2].Username != "bob" {
		t.Fatalf("credits asc order users=%+v err=%v", users, err)
	}

	_, total, err = ListUsers(model.Query{Status: "does-not-exist"})
	if err != nil || total != 0 {
		t.Fatalf("unknown status total=%d err=%v", total, err)
	}
}
