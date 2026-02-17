---
description: Display current project status - show progress, features, and recent activity
---

# Project Status Workflow

This workflow provides a comprehensive overview of the current project state.

## Step 1: Confirm Working Directory

// turbo
1. Run `pwd` to confirm you're in the correct project directory

## Step 2: Read Project State Files

2. Read the following files using IDE's built-in file reading tool:
   - `claude-progress.txt` — recent session activity
   - `feature_list.json` — all features and their status
   - `app_spec.md` — project specification

## Step 3: Analyze Git History

// turbo
4. Check recent commits:
   ```bash
   git log --oneline -15
   ```

// turbo
5. Check for uncommitted changes:
   ```bash
   git status
   ```

## Step 4: Generate Status Report

6. Generate a status report with feature progress, recent activity, and recommendations.

## Step 5: Provide Quick Summary

7. Provide a TL;DR:
   ```
   Progress: X/20 features (XX%) completed
   Last Activity: <date> - <what was done>
   Current Focus: <current or next feature>
   Health: 🟢 Good / 🟡 Needs Attention / 🔴 Critical Issues
   ```
