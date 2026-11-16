-- #495. Run as the storefront database owner after migrations 0042 and 0043.
GRANT SELECT ON public.assistant_chats, public.assistant_messages, public.assistant_handoffs TO creoms_readonly;
