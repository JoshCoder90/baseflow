-- Pause/resume: default status + unify legacy "sending" with "active"
alter table campaigns alter column status set default 'draft';

update campaigns set status = 'active' where status = 'sending';
