-- Add lead_generation_stage for finer progress messaging during generation
-- Values: 'searching' | 'enriching' | null (null = use default when status is generating)
alter table campaigns
  add column if not exists lead_generation_stage text;
