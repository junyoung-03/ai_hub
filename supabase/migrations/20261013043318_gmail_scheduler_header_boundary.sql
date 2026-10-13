-- Scheduled request headers contain a server-only Bearer token.
-- pg_net's default public queue grants must not expose it to API roles.
-- Extension-owned SECURITY DEFINER functions and postgres Cron retain access.
revoke all on table net.http_request_queue from public,anon,authenticated,service_role;
