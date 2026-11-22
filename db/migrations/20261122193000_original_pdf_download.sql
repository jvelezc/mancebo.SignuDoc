alter table public.recipient_download_tokens
  drop constraint recipient_download_tokens_file_type_check,
  add constraint recipient_download_tokens_file_type_check
  check (file_type in ('signed', 'evidence', 'original'));
