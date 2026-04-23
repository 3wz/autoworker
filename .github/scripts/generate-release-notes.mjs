import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

function lines(value) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function commitRange(previousTag, tag) {
  if (previousTag) return `${previousTag}...${tag}`;
  return tag;
}

function commitSubjects(range) {
  return lines(run('git', ['log', '--format=%h%x09%s', range]));
}

function summarize(tag, previousTag, commits) {
  if (!previousTag) {
    return [
      `这是 ${tag} 的首次公开发布。`,
      `本版本基于当前 tag 中的 ${commits.length || 1} 条提交生成发布说明。`
    ];
  }
  return [
    `这是 ${tag} 相对 ${previousTag} 的发布。`,
    `本版本汇总了 ${commits.length || 1} 条提交范围内的变更。`
  ];
}

function changeBullets(commits) {
  if (!commits.length) return ['- 当前 tag 没有可读取的提交记录。'];
  return commits.slice(0, 12).map((entry) => {
    const [hash, subject] = entry.split('\t');
    return `- ${subject || entry}（${hash}）`;
  });
}

function verificationBullets() {
  const raw = process.env.RELEASE_VERIFICATION_COMMANDS || 'npm test\nnpm pack --dry-run\nrelease workflow';
  return lines(raw).map((item) => {
    if (item === 'release workflow') return '- Release workflow：执行测试、打包、npm 发布和 GitHub Release 创建';
    return `- \`${item}\``;
  });
}

function riskBullets(previousTag) {
  const risks = [
    '- npm 发布仍取决于发布账号对目标包名的权限。',
    '- 测试使用 fake Codex 覆盖启动链路，但不模拟完整交互式 Codex UI。'
  ];
  if (!previousTag) {
    risks.push('- 首次发布没有上一个 tag 可比较，完整变更链接会退回到当前 tag 的提交列表。');
  }
  risks.push('- 本版本仍限定 OMX + Codex + tmux 工作流。');
  return risks;
}

const tag = process.env.GITHUB_REF_NAME || run('git', ['describe', '--tags', '--abbrev=0']) || 'v0.1.0';
const repo = process.env.GITHUB_REPOSITORY || '3wz/autoworker';
const previousTag = run('git', ['describe', '--tags', '--abbrev=0', `${tag}^`]);
const range = commitRange(previousTag, tag);
const commits = commitSubjects(range);
const changelogTarget = previousTag
  ? `https://github.com/${repo}/compare/${previousTag}...${tag}`
  : `https://github.com/${repo}/commits/${tag}`;

const body = `# ${tag}

## 概要

${summarize(tag, previousTag, commits).map((item) => `- ${item}`).join('\n')}

## 变更

${changeBullets(commits).join('\n')}

## 验证

${verificationBullets().join('\n')}

## 剩余风险

${riskBullets(previousTag).join('\n')}

## 完整变更

${previousTag ? `[${previousTag}...${tag}](${changelogTarget})` : `[${tag} 提交列表](${changelogTarget})`}
`;

await fs.writeFile('release-notes.md', body);
console.log(`wrote release-notes.md for ${tag}`);
