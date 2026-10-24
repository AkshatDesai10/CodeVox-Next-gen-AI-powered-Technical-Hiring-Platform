-- In-app notifications, feedback, user preferences (topbar / app shell).
-- Apply manually when deploying.

CREATE TABLE IF NOT EXISTS app_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  userId BIGINT UNSIGNED NOT NULL,
  actorId BIGINT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  entityType VARCHAR(32) NOT NULL,
  entityId VARCHAR(64) NOT NULL,
  metadata JSON NULL,
  readFlag TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_app_notifications_user_read_created (userId, readFlag, createdAt DESC),
  KEY idx_app_notifications_user_created (userId, createdAt DESC),
  CONSTRAINT fk_app_notifications_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_app_notifications_actor FOREIGN KEY (actorId) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  userId BIGINT UNSIGNED NULL,
  message TEXT NOT NULL,
  page VARCHAR(512) NULL,
  userAgent VARCHAR(512) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_app_feedback_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  userId BIGINT UNSIGNED NOT NULL,
  theme VARCHAR(16) NOT NULL DEFAULT 'SYSTEM',
  language VARCHAR(16) NOT NULL DEFAULT 'en',
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_user_preferences_user (userId),
  CONSTRAINT fk_user_preferences_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);
