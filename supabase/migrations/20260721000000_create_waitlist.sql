-- Create Waitlist table for Cloud Waitlist signups
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.waitlist enable row level security;

-- Create insertion policy for public waitlist submissions
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'waitlist' and policyname = 'Allow public waitlist insertions'
  ) then
    create policy "Allow public waitlist insertions" on public.waitlist for insert with check (true);
  end if;
end $$;
