-- Migration 0006: add Opus-4.8 model mappings
WITH candidates(id, label, provider, upstream_model, reasoning_budget, sort_offset) AS (
	VALUES
		('opus-4.8', 'Opus 4.8', 'claude', 'claude-opus-4-8', NULL, 1),
		('opus-4.8-low', 'Opus 4.8 Low', 'claude', 'claude-opus-4-8', 'low', 2),
		('opus-4.8-medium', 'Opus 4.8 Medium', 'claude', 'claude-opus-4-8', 'medium', 3),
		('opus-4.8-high', 'Opus 4.8 High', 'claude', 'claude-opus-4-8', 'high', 4),
		('opus-4.8-xhigh', 'Opus 4.8 XHigh', 'claude', 'claude-opus-4-8', 'xhigh', 5)
),
base_sort_order(value) AS (
	SELECT COALESCE(MAX(sort_order), -1)
	FROM model_mappings
),
resolved_candidates AS (
	SELECT
		candidate.id,
		candidate.label,
		candidate.provider,
		candidate.upstream_model,
		(SELECT value FROM base_sort_order) + candidate.sort_offset AS sort_order,
		candidate.reasoning_budget
	FROM candidates AS candidate
)
INSERT OR IGNORE INTO model_mappings (id, label, provider, upstream_model, sort_order, reasoning_budget)
SELECT candidate.id, candidate.label, candidate.provider, candidate.upstream_model, candidate.sort_order, candidate.reasoning_budget
FROM resolved_candidates AS candidate
WHERE NOT EXISTS (
	SELECT 1
	FROM model_mappings AS existing
	WHERE existing.provider = candidate.provider
		AND existing.upstream_model = candidate.upstream_model
		AND (
			existing.reasoning_budget = candidate.reasoning_budget
			OR (existing.reasoning_budget IS NULL AND candidate.reasoning_budget IS NULL)
		)
);
