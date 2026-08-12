CREATE DATABASE IF NOT EXISTS chacommaria;
USE chacommaria;

CREATE TABLE IF NOT EXISTS clientes (
  id INT NOT NULL AUTO_INCREMENT,
  nome VARCHAR(50) NOT NULL,
  email VARCHAR(50) NOT NULL,
  cidade VARCHAR(50) NOT NULL,
  telefone VARCHAR(20) NOT NULL,
  quantidade INT NOT NULL DEFAULT 1,
  valor_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  status_pagamento ENUM('pendente','pago') NOT NULL DEFAULT 'pendente',
  PRIMARY KEY (id)
);
