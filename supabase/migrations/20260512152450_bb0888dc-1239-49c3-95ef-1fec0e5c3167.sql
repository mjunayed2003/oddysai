UPDATE public.email_send_state
SET batch_size = 1,
    send_delay_ms = 2000,
    auth_email_ttl_minutes = 120,
    transactional_email_ttl_minutes = 120,
    updated_at = now()
WHERE id = 1;