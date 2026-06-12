alter table landing_contacts
  add column if not exists status text not null default 'nueva'
    check (status in ('nueva', 'vista', 'contactada', 'convertida'));
