ALTER TABLE t10.companies DROP CONSTRAINT IF EXISTS companies_inn_check;
ALTER TABLE t10.companies DROP CONSTRAINT IF EXISTS companies_ogrn_check;
ALTER TABLE t10.companies
  ADD CONSTRAINT companies_inn_check CHECK (inn IS NULL OR inn ~ '^[0-9]{10}([0-9]{2})?$'),
  ADD CONSTRAINT companies_ogrn_check CHECK (ogrn IS NULL OR ogrn ~ '^[0-9]{13}([0-9]{2})?$');
