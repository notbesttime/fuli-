package repository

import (
	"errors"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

// ListUsers 分页查询用户。
func ListUsers(q model.Query) ([]model.User, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.User{})
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("username LIKE ? OR display_name LIKE ? OR email LIKE ? OR linux_do_id LIKE ?", like, like, like, like)
	}
	if role := strings.TrimSpace(q.Role); role != "" {
		tx = tx.Where("role = ?", role)
	}
	if status := strings.TrimSpace(q.Status); status != "" {
		tx = tx.Where("status = ?", status)
	}
	if group := strings.TrimSpace(q.Group); group != "" {
		// group 为 SQL 保留字，用 map 条件让 GORM 按方言正确加引号。
		tx = tx.Where(map[string]any{"group": group})
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var users []model.User
	err = tx.Order(userListOrder(q.SortBy, q.SortOrder)).Offset(q.Offset()).Limit(q.PageSize).Find(&users).Error
	return users, total, err
}

// userListOrder 将后台排序参数映射为白名单列，避免注入并保证稳定次序。
func userListOrder(sortBy, sortOrder string) string {
	columns := map[string]string{
		"id":            "id",
		"username":      "username",
		"credits":       "credits",
		"created_at":    "created_at",
		"last_login_at": "last_login_at",
	}
	column, ok := columns[strings.ToLower(strings.TrimSpace(sortBy))]
	if !ok {
		column = "created_at"
	}
	dir := "desc"
	if strings.EqualFold(strings.TrimSpace(sortOrder), "asc") {
		dir = "asc"
	}
	if column == "id" {
		return "id " + dir
	}
	return column + " " + dir + ", id desc"
}

// CountUsers 返回用户总数。
func CountUsers() (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var total int64
	return total, db.Model(&model.User{}).Count(&total).Error
}

// HasAdmin 判断系统中是否存在管理员。
func HasAdmin() (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	var total int64
	err = db.Model(&model.User{}).Where("role = ?", model.UserRoleAdmin).Count(&total).Error
	return total > 0, err
}

// GetUserByID 根据 ID 查询用户。
func GetUserByID(id string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "id = ?", id)
}

// GetUserByUsername 根据用户名查询用户。
func GetUserByUsername(username string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "username = ?", username)
}

// GetUserByEmail 按邮箱查询用户。
func GetUserByEmail(email string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "email = ?", email)
}

// SaveUser 保存用户信息。
func SaveUser(user model.User) (model.User, error) {
	db, err := DB()
	if err != nil {
		return user, err
	}
	return user, db.Save(&user).Error
}

func UpdateUserPreferences(id, strategy, preferredGroup, updatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	updates := map[string]any{"updated_at": updatedAt}
	if strategy != "" {
		updates["billing_strategy"] = strategy
	}
	if preferredGroup != "" {
		updates["preferred_group"] = preferredGroup
	}
	result := db.Model(&model.User{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

func ConsumeUserCredits(id string, credits float64, now string, log model.CreditLog, task any) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	if credits <= 0 {
		user, ok, err := GetUserByID(id)
		return user, ok, err
	}
	var user model.User
	consumed := false
	err = db.Transaction(func(tx *gorm.DB) error {
		update := tx.Model(&model.User{}).Where("id = ? AND credits >= CAST(? AS DECIMAL(20,4))", id, credits).Updates(map[string]any{
			"credits":    gorm.Expr("ROUND(credits - CAST(? AS DECIMAL(20,4)), 4)", credits),
			"updated_at": now,
		})
		if update.Error != nil || update.RowsAffected == 0 {
			return update.Error
		}
		current, found, err := findUser(tx, "id = ?", id)
		if err != nil {
			return err
		}
		if !found {
			return gorm.ErrRecordNotFound
		}
		user, consumed = current, true
		log.Balance = user.Credits
		if err := tx.Save(&log).Error; err != nil {
			return err
		}
		if task != nil {
			return tx.Create(task).Error
		}
		return nil
	})
	return user, consumed, err
}

func RefundUserCredits(id string, credits float64, now string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return refundUserCredits(db, id, credits, now)
}

func refundUserCredits(db *gorm.DB, id string, credits float64, now string) (model.User, bool, error) {
	if credits <= 0 {
		return findUser(db, "id = ?", id)
	}
	tx := db.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{
		"credits":    gorm.Expr("ROUND(credits + CAST(? AS DECIMAL(20,4)), 4)", credits),
		"updated_at": now,
	})
	if tx.Error != nil {
		return model.User{}, false, tx.Error
	}
	user, ok, err := findUser(db, "id = ?", id)
	return user, ok && tx.RowsAffected > 0, err
}

// SaveCreditLog 保存算力点变更流水。
func SaveCreditLog(log model.CreditLog) (model.CreditLog, error) {
	db, err := DB()
	if err != nil {
		return log, err
	}
	return log, db.Save(&log).Error
}

func ListUserCreditLogs(userID string, q model.Query, earnedOnly bool) ([]model.CreditLog, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.CreditLog{}).Where("user_id = ?", userID)
	if earnedOnly {
		tx = tx.Where("amount > 0")
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []model.CreditLog
	err = tx.Order("created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&logs).Error
	return logs, total, err
}

func UserCreditLogSummary(userID string) (model.UserCreditLogSummary, error) {
	db, err := DB()
	if err != nil {
		return model.UserCreditLogSummary{}, err
	}
	var summary model.UserCreditLogSummary
	err = db.Model(&model.CreditLog{}).
		Select("COALESCE(SUM(-amount), 0) AS total_spent, COUNT(*) AS billed_requests").
		Where("user_id = ? AND type = ? AND amount < 0", userID, model.CreditLogTypeAIConsume).
		Scan(&summary).Error
	return summary, err
}

func ListUserAICreditLogs(userID string) ([]model.CreditLog, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var logs []model.CreditLog
	err = db.Where("user_id = ? AND type = ? AND amount < 0", userID, model.CreditLogTypeAIConsume).
		Order("created_at desc").Find(&logs).Error
	return logs, err
}

func ListRecentUserCreditLogs(userID string, limit int) ([]model.CreditLog, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var logs []model.CreditLog
	err = db.Where("user_id = ?", userID).Order("created_at desc").Limit(limit).Find(&logs).Error
	return logs, err
}

func ListCreditLogs(q model.Query) ([]model.CreditLog, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.CreditLog{}).Joins("LEFT JOIN users ON users.id = credit_logs.user_id")
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("user_id LIKE ? OR type LIKE ? OR remark LIKE ? OR related_id LIKE ? OR users.username LIKE ? OR users.display_name LIKE ?", like, like, like, like, like, like)
	}
	if q.Date != "" {
		if date, parseErr := time.Parse(time.DateOnly, q.Date); parseErr == nil {
			tx = tx.Where("credit_logs.created_at >= ? AND credit_logs.created_at < ?", q.Date, date.AddDate(0, 0, 1).Format(time.DateOnly))
		} else {
			tx = tx.Where("SUBSTR(credit_logs.created_at, 1, 10) = ?", q.Date)
		}
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []model.CreditLog
	order := "credit_logs.created_at desc"
	if db.Dialector.Name() == "sqlite" {
		order += ", credit_logs.rowid desc"
	}
	err = tx.Select("credit_logs.*, COALESCE(NULLIF(users.display_name, ''), users.username) AS user_display_name").Order(order).Offset(q.Offset()).Limit(q.PageSize).Find(&logs).Error
	return logs, total, err
}

func DeleteCreditLog(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.CreditLog{}, "id = ?", id).Error
}

// DeleteUser 删除指定用户。
func DeleteUser(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.User{}, "id = ?", id).Error
}

// GetUserByLinuxDoID 根据 Linux.do ID 查询用户。
func GetUserByLinuxDoID(id string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "linux_do_id = ?", id)
}

// findUser 查询单个用户，并将未命中转换为 ok=false。
func findUser(db *gorm.DB, query string, args ...any) (model.User, bool, error) {
	user := model.User{}
	err := db.Where(query, args...).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, false, nil
	}
	return user, err == nil, err
}
