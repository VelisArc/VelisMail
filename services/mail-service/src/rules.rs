//! Email processing rules engine
//!
//! Implements organization-specific rules for automatic email processing,
//! including auto-labels, auto-archive, and auto-reply rules.

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use velismail_common::FolderType;

/// Email processing rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailRule {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub enabled: bool,
    pub conditions: RuleConditions,
    pub actions: RuleActions,
    pub priority: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Conditions that trigger a rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleConditions {
    /// Match emails from these addresses (supports wildcards)
    pub from: Option<Vec<String>>,
    /// Match emails to these addresses
    pub to: Option<Vec<String>>,
    /// Match subject line (regex)
    pub subject_contains: Option<Vec<String>>,
    /// Match email body (regex)
    pub body_contains: Option<Vec<String>>,
    /// Match emails with/without attachments
    pub has_attachments: Option<bool>,
    /// Match based on size (in bytes)
    pub size_greater_than: Option<i64>,
    pub size_less_than: Option<i64>,
    /// All conditions must match (AND) vs any (OR)
    pub match_all: bool,
}

/// Actions to execute when rule matches
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleActions {
    /// Apply labels
    pub apply_labels: Option<Vec<String>>,
    /// Move to folder
    pub move_to_folder: Option<FolderType>,
    /// Mark as read/unread
    pub mark_as_read: Option<bool>,
    /// Mark as starred
    pub mark_as_starred: Option<bool>,
    /// Archive the email
    pub archive: Option<bool>,
    /// Delete the email
    pub delete: Option<bool>,
    /// Add a notification
    pub notify: Option<bool>,
    /// Forward to address
    pub forward_to: Option<String>,
}

/// Result of evaluating a rule against an email
#[derive(Debug, Clone)]
pub struct RuleEvaluationResult {
    pub rule_id: Uuid,
    pub matched: bool,
    pub actions_executed: Vec<String>,
    pub errors: Vec<String>,
}

/// Email rules engine
pub struct RulesEngine {
    rules: Vec<EmailRule>,
}

impl RulesEngine {
    /// Create a new rules engine
    pub fn new(rules: Vec<EmailRule>) -> Self {
        // Sort rules by priority
        let mut sorted_rules = rules;
        sorted_rules.sort_by(|a, b| a.priority.cmp(&b.priority));

        Self {
            rules: sorted_rules,
        }
    }

    /// Evaluate all rules against an email
    pub fn evaluate_email(
        &self,
        from: &str,
        to: &[String],
        subject: &str,
        body: &str,
        size_bytes: i64,
        has_attachments: bool,
    ) -> Vec<RuleEvaluationResult> {
        let mut results = Vec::new();

        for rule in &self.rules {
            if !rule.enabled {
                continue;
            }

            let matched =
                self.check_conditions(rule, from, to, subject, body, size_bytes, has_attachments);

            let actions_executed = if matched {
                self.get_actions(&rule.actions)
            } else {
                Vec::new()
            };

            results.push(RuleEvaluationResult {
                rule_id: rule.id,
                matched,
                actions_executed,
                errors: Vec::new(),
            });
        }

        results
    }

    /// Check if email matches rule conditions
    fn check_conditions(
        &self,
        rule: &EmailRule,
        from: &str,
        to: &[String],
        subject: &str,
        body: &str,
        size_bytes: i64,
        has_attachments: bool,
    ) -> bool {
        let conditions = &rule.conditions;

        // Check individual conditions
        let from_match = self.check_from_condition(&conditions.from, from);
        let to_match = self.check_to_condition(&conditions.to, to);
        let subject_match = self.check_subject_condition(&conditions.subject_contains, subject);
        let body_match = self.check_body_condition(&conditions.body_contains, body);
        let attachments_match =
            self.check_attachments_condition(conditions.has_attachments, has_attachments);
        let size_match = self.check_size_condition(
            conditions.size_greater_than,
            conditions.size_less_than,
            size_bytes,
        );

        // Combine results based on match_all flag
        if conditions.match_all {
            // All conditions must match
            from_match && to_match && subject_match && body_match && attachments_match && size_match
        } else {
            // At least one condition must match
            from_match || to_match || subject_match || body_match || attachments_match || size_match
        }
    }

    fn check_from_condition(&self, from_patterns: &Option<Vec<String>>, from: &str) -> bool {
        match from_patterns {
            None => false,
            Some(patterns) => patterns
                .iter()
                .any(|pattern| self.matches_pattern(pattern, from)),
        }
    }

    fn check_to_condition(&self, to_patterns: &Option<Vec<String>>, to: &[String]) -> bool {
        match to_patterns {
            None => false,
            Some(patterns) => to.iter().any(|addr| {
                patterns
                    .iter()
                    .any(|pattern| self.matches_pattern(pattern, addr))
            }),
        }
    }

    fn check_subject_condition(
        &self,
        subject_patterns: &Option<Vec<String>>,
        subject: &str,
    ) -> bool {
        match subject_patterns {
            None => false,
            Some(patterns) => patterns.iter().any(|pattern| {
                if let Ok(re) = Regex::new(pattern) {
                    re.is_match(subject)
                } else {
                    subject.contains(pattern)
                }
            }),
        }
    }

    fn check_body_condition(&self, body_patterns: &Option<Vec<String>>, body: &str) -> bool {
        match body_patterns {
            None => false,
            Some(patterns) => patterns.iter().any(|pattern| {
                if let Ok(re) = Regex::new(pattern) {
                    re.is_match(body)
                } else {
                    body.contains(pattern)
                }
            }),
        }
    }

    fn check_attachments_condition(&self, condition: Option<bool>, has_attachments: bool) -> bool {
        match condition {
            None => false,
            Some(expected) => expected == has_attachments,
        }
    }

    fn check_size_condition(
        &self,
        greater_than: Option<i64>,
        less_than: Option<i64>,
        size: i64,
    ) -> bool {
        let greater_check = match greater_than {
            None => false,
            Some(threshold) => size > threshold,
        };

        let less_check = match less_than {
            None => false,
            Some(threshold) => size < threshold,
        };

        greater_check || less_check
    }

    fn matches_pattern(&self, pattern: &str, value: &str) -> bool {
        // Simple wildcard matching (* matches any characters)
        if pattern.contains('*') {
            let parts: Vec<&str> = pattern.split('*').collect();
            match parts.as_slice() {
                [prefix, suffix] => {
                    if prefix.is_empty() && suffix.is_empty() {
                        true
                    } else if prefix.is_empty() {
                        value.ends_with(suffix)
                    } else if suffix.is_empty() {
                        value.starts_with(prefix)
                    } else {
                        value.starts_with(prefix) && value.ends_with(suffix)
                    }
                }
                _ => false,
            }
        } else {
            pattern == value
        }
    }

    fn get_actions(&self, actions: &RuleActions) -> Vec<String> {
        let mut action_list = Vec::new();

        if actions.apply_labels.is_some() {
            action_list.push("apply_labels".to_string());
        }
        if actions.move_to_folder.is_some() {
            action_list.push("move_to_folder".to_string());
        }
        if let Some(true) = actions.mark_as_read {
            action_list.push("mark_as_read".to_string());
        }
        if let Some(true) = actions.mark_as_starred {
            action_list.push("mark_as_starred".to_string());
        }
        if let Some(true) = actions.archive {
            action_list.push("archive".to_string());
        }
        if let Some(true) = actions.delete {
            action_list.push("delete".to_string());
        }
        if let Some(true) = actions.notify {
            action_list.push("notify".to_string());
        }
        if actions.forward_to.is_some() {
            action_list.push("forward_to".to_string());
        }

        action_list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_from_pattern_matching() {
        let engine = RulesEngine::new(vec![]);
        assert!(engine.matches_pattern("*@example.com", "user@example.com"));
        assert!(engine.matches_pattern("test@*", "test@example.com"));
        assert!(!engine.matches_pattern("*@example.com", "user@other.com"));
    }

    #[test]
    fn test_rule_conditions_matching() {
        let conditions = RuleConditions {
            from: Some(vec!["*@example.com".to_string()]),
            to: None,
            subject_contains: None,
            body_contains: None,
            has_attachments: None,
            size_greater_than: None,
            size_less_than: None,
            match_all: false,
        };

        let rule = EmailRule {
            id: Uuid::new_v4(),
            organization_id: Uuid::new_v4(),
            name: "Test Rule".to_string(),
            enabled: true,
            conditions,
            actions: RuleActions {
                apply_labels: None,
                move_to_folder: None,
                mark_as_read: None,
                mark_as_starred: None,
                archive: None,
                delete: None,
                notify: None,
                forward_to: None,
            },
            priority: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let engine = RulesEngine::new(vec![rule]);
        let results = engine.evaluate_email(
            "test@example.com",
            &["recipient@test.com".to_string()],
            "Test Subject",
            "Test Body",
            1024,
            false,
        );

        assert!(!results.is_empty());
        assert!(results[0].matched);
    }
}
