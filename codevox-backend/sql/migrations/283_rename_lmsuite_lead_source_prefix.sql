-- Rename legacy application source prefix after LMSuite removal.
UPDATE job_applications
SET source = CONCAT('lead:', SUBSTRING(source, LENGTH('lmsuite_lead:') + 1))
WHERE source LIKE 'lmsuite_lead:%';
