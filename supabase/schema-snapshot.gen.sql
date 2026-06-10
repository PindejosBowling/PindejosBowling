-- Reconstructs the current-state DDL of the public schema from the live catalog.
-- Output: a single row, single column (schema_sql) containing the full dump text.
with parts as (
  -- ---------- section headers + tables ----------
  select 1 as s, '' as sk,
    E'-- =====================================================\n'
    '-- TABLES\n'
    '-- =====================================================' as ddl
  union all
  select 1, c.relname,
    'CREATE TABLE ' || quote_ident(c.relname) || E' (\n' ||
    string_agg(
      '  ' || quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod)
      || case when a.attnotnull then ' NOT NULL' else '' end
      || coalesce(' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid), ''),
      E',\n' order by a.attnum
    ) || E'\n);'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
  where c.relkind = 'r'
  group by c.relname

  -- ---------- constraints (PK / FK / UNIQUE / CHECK) ----------
  union all
  select 2, '',
    E'\n-- =====================================================\n'
    '-- CONSTRAINTS\n'
    '-- ====================================================='
  union all
  select 2, rel.relname || '.' || con.conname,
    'ALTER TABLE ' || quote_ident(rel.relname)
    || ' ADD CONSTRAINT ' || quote_ident(con.conname)
    || ' ' || pg_get_constraintdef(con.oid) || ';'
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace and n.nspname = 'public'

  -- ---------- indexes (excluding those backing constraints) ----------
  union all
  select 3, '',
    E'\n-- =====================================================\n'
    '-- INDEXES\n'
    '-- ====================================================='
  union all
  select 3, ic.relname, pg_get_indexdef(i.indexrelid) || ';'
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join pg_class tc on tc.oid = i.indrelid
  join pg_namespace n on n.oid = ic.relnamespace and n.nspname = 'public'
  where not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)

  -- ---------- row level security: enable + policies ----------
  union all
  select 4, '',
    E'\n-- =====================================================\n'
    '-- ROW LEVEL SECURITY\n'
    '-- ====================================================='
  union all
  select 4, c.relname || '.0',
    'ALTER TABLE ' || quote_ident(c.relname) || ' ENABLE ROW LEVEL SECURITY;'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind = 'r' and c.relrowsecurity
  union all
  select 4, p.tablename || '.' || p.policyname,
    'CREATE POLICY ' || quote_ident(p.policyname) || ' ON ' || quote_ident(p.tablename)
    || ' AS ' || p.permissive
    || ' FOR ' || p.cmd
    || ' TO ' || array_to_string(p.roles, ', ')
    || coalesce(E'\n  USING (' || p.qual || ')', '')
    || coalesce(E'\n  WITH CHECK (' || p.with_check || ')', '') || ';'
  from pg_policies p
  where p.schemaname = 'public'

  -- ---------- functions & procedures ----------
  union all
  select 5, '',
    E'\n-- =====================================================\n'
    '-- FUNCTIONS & PROCEDURES\n'
    '-- ====================================================='
  union all
  select 5, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    pg_get_functiondef(p.oid) || ';'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.prokind in ('f', 'p')

  -- ---------- triggers ----------
  union all
  select 6, '',
    E'\n-- =====================================================\n'
    '-- TRIGGERS\n'
    '-- ====================================================='
  union all
  select 6, c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where not t.tgisinternal
)
select
  E'-- Current-state schema snapshot of the public schema.\n'
  '-- GENERATED — do not edit by hand. Regenerate after every `supabase db push`.\n'
  '-- Source of truth for CURRENT schema; migration files are append-only history.\n\n'
  || string_agg(ddl, E'\n\n' order by s, sk) as schema_sql
from parts;
