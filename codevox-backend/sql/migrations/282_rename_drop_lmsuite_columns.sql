-- Remove LMSuite naming from local schema. Local IDs stay; external sync flag dropped.

-- recruitment_lead_overlay
ALTER TABLE recruitment_lead_overlay
  DROP INDEX uq_recruitment_lead_overlay_lmsuite_lead_id,
  CHANGE COLUMN lmsuite_lead_id lead_id VARCHAR(64) NOT NULL,
  ADD UNIQUE KEY uq_recruitment_lead_overlay_lead_id (lead_id);

-- recruitment_interview_overlay
ALTER TABLE recruitment_interview_overlay
  CHANGE COLUMN lmsuite_lead_id lead_id VARCHAR(64) NOT NULL,
  CHANGE COLUMN lmsuite_interview_id interview_ref_id VARCHAR(64) NULL,
  DROP COLUMN pending_lmsuite_sync;

-- recruitment_lead_interview_link
ALTER TABLE recruitment_lead_interview_link
  CHANGE COLUMN lmsuite_lead_id lead_id VARCHAR(64) NOT NULL,
  CHANGE COLUMN lmsuite_interview_id interview_ref_id VARCHAR(64) NULL;

-- recruitment_communication_log
ALTER TABLE recruitment_communication_log
  CHANGE COLUMN lmsuite_lead_id lead_id VARCHAR(64) NOT NULL;

-- recruitment_activity_log
ALTER TABLE recruitment_activity_log
  CHANGE COLUMN lmsuite_lead_id lead_id VARCHAR(64) NULL,
  CHANGE COLUMN lmsuite_interview_id interview_ref_id VARCHAR(64) NULL;

-- snapshots
ALTER TABLE interview_round_question_snapshots
  CHANGE COLUMN lmsuite_lead_id lead_id VARCHAR(64) NULL;

ALTER TABLE interview_round_problem_snapshots
  CHANGE COLUMN lmsuite_lead_id lead_id VARCHAR(64) NULL;

-- job profiles: drop unused external catalog id
ALTER TABLE job_profiles
  DROP COLUMN lmsuite_profile_id;
