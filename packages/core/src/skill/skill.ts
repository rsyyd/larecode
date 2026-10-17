export type SkillState = 'draft' | 'active' | 'disabled';

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  state: SkillState;
  source: 'auto' | 'user';
}

export interface Skill extends SkillMetadata {
  prompt: string;
  hash: string;
}

export class Skills {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): SkillMetadata[] {
    return Array.from(this.skills.values());
  }

  approve(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill || skill.state !== 'draft') return false;
    skill.state = 'active';
    return true;
  }
}
