import { describe, expect, it } from 'vitest';
import {
  defaultWorktreeBranchBinding,
  isWorktreeBranchBindingValid,
  parseWorktreeBranchBinding,
} from './worktreeBranchBinding';

describe('worktreeBranchBinding', () => {
  it('defaults to explicit auto mode', () => {
    expect(defaultWorktreeBranchBinding()).toEqual({
      mode: 'auto',
      existingBranch: '',
      newBranchName: '',
      startPoint: '',
    });
  });

  it('parses legacy existing-branch drafts', () => {
    expect(parseWorktreeBranchBinding({ kind: 'existing', branch: 'release/v1' })).toEqual({
      mode: 'existing',
      existingBranch: 'release/v1',
      newBranchName: '',
      startPoint: '',
    });
  });

  it('infers mode from legacy field-only drafts', () => {
    expect(
      parseWorktreeBranchBinding({
        existingBranch: '',
        newBranchName: 'feature/worktree-ui',
        startPoint: 'main',
      })
    ).toEqual({
      mode: 'new',
      existingBranch: '',
      newBranchName: 'feature/worktree-ui',
      startPoint: 'main',
    });
  });

  it('validates required fields for each explicit mode', () => {
    expect(
      isWorktreeBranchBindingValid({
        mode: 'auto',
        existingBranch: 'main',
        newBranchName: '',
        startPoint: '',
      })
    ).toBe(true);

    expect(
      isWorktreeBranchBindingValid({
        mode: 'auto',
        existingBranch: '',
        newBranchName: '',
        startPoint: 'main',
      })
    ).toBe(true);

    expect(
      isWorktreeBranchBindingValid({
        mode: 'existing',
        existingBranch: '',
        newBranchName: '',
        startPoint: '',
      })
    ).toBe(false);

    expect(
      isWorktreeBranchBindingValid({
        mode: 'new',
        existingBranch: '',
        newBranchName: '',
        startPoint: '',
      })
    ).toBe(false);

    expect(
      isWorktreeBranchBindingValid({
        mode: 'new',
        existingBranch: 'main',
        newBranchName: 'feature/worktree-ui',
        startPoint: '',
      })
    ).toBe(true);
  });
});
