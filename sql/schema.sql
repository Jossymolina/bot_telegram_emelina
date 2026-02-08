CREATE DATABASE IF NOT EXISTS constancias_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE constancias_bot;

-- Turnos/cola
CREATE TABLE IF NOT EXISTS queue_turns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  channel VARCHAR(20) NOT NULL DEFAULT 'telegram',
  user_id VARCHAR(64) NOT NULL,
  status ENUM('EN_COLA','ATENDIENDO','FINALIZADO','CANCELADO') NOT NULL DEFAULT 'EN_COLA',
  step VARCHAR(50) NOT NULL DEFAULT 'START',
  waiting_for_user TINYINT(1) NOT NULL DEFAULT 0,
  last_bot_message_at DATETIME NULL,
  last_user_message_at DATETIME NULL,
  deadline_at DATETIME NULL,
  assigned_at DATETIME NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  cancel_reason VARCHAR(60) NULL,
  cancel_detail VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_active (user_id, status),
  KEY idx_status_deadline (status, deadline_at),
  KEY idx_status_created (status, created_at)
);

-- Sesión (contexto del trámite)
CREATE TABLE IF NOT EXISTS sessions (
  user_id VARCHAR(64) PRIMARY KEY,
  state VARCHAR(50) NOT NULL DEFAULT 'START',
  context JSON NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Auditoría
CREATE TABLE IF NOT EXISTS queue_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  turn_id BIGINT UNSIGNED NOT NULL,
  event VARCHAR(40) NOT NULL,
  data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_turn (turn_id)
);

-- Outbox (envíos confiables)
CREATE TABLE IF NOT EXISTS outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  type ENUM('text','document','photo','audio') NOT NULL DEFAULT 'text',
  payload JSON NOT NULL,
  status ENUM('PENDING','SENT','ERROR') NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  KEY idx_status_created (status, created_at)
);

-- API keys para el gateway (otro sistema)
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  api_key VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_key (api_key)
);
