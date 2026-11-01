-- Scheduled jobs (plan §7.5.1 exchange rates, §8.5 notifications).
-- pg_cron calls Edge Functions through pg_net with a shared secret header.
-- The project URL and that secret live in Vault ('project_url', 'cron_secret'),
-- created outside this repository; nothing secret is written here.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- POSTs to one Edge Function. Returns the pg_net request id, or null when the
-- Vault entries are missing (the job then does nothing).
create or replace function private.call_function(p_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_name !~ '^[a-z0-9-]+$' then
    raise exception 'invalid function name';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_name,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    timeout_milliseconds := 15000
  );
end;
$$;
revoke all on function private.call_function(text) from public, anon, authenticated;

-- Exchange rates: 18:15 and 04:15 Sydney summer time (07:15 / 17:15 UTC), after
-- the ECB reference rate is published. Re-running cron.schedule with the same
-- name replaces the job.
select cron.schedule('fetch-fx', '15 7,17 * * *', $$select private.call_function('fetch-fx')$$);
