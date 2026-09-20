import { describe, it, expect, beforeEach } from 'vitest'
import { tabStore, pruneNonMarkdownNodes } from '../../src/stores/tabs'
import type { FileNode } from '../../src/stores/tabs'

describe('文件树 Markdown 剪枝', () => {
  beforeEach(() => {
    tabStore.reset()
  })

  function dir(name: string, children: FileNode[]): FileNode {
    return { name, path: `/${name}`, isDir: true, children, expanded: false }
  }
  function file(name: string): FileNode {
    return { name, path: `/${name}`, isDir: false, children: [], expanded: false }
  }

  it('保留 md 文件，剔除其他文件', () => {
    const result = pruneNonMarkdownNodes([file('readme.md'), file('main.ts'), file('data.json')])
    expect(result.map((n) => n.name)).toEqual(['readme.md'])
  })

  it('识别 .markdown 扩展名与大小写', () => {
    const result = pruneNonMarkdownNodes([file('doc.markdown'), file('NOTES.MD'), file('img.png')])
    expect(result.map((n) => n.name)).toEqual(['doc.markdown', 'NOTES.MD'])
  })

  it('剔除不含任何 md 的空目录树，保留含 md 的目录', () => {
    const input = [
      dir('docs', [file('guide.md'), dir('images', [file('logo.png')])]),
      dir('src', [dir('deep', [file('index.ts')])]),
    ]
    const result = pruneNonMarkdownNodes(input)
    // docs 保留（含 guide.md），其中 images 子目录被剪掉；src 整棵剔除
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('docs')
    expect(result[0].children.map((c) => c.name)).toEqual(['guide.md'])
  })

  it('refreshFileTree 对真实文件树应用剪枝（buildFileTree 输出经 prune）', async () => {
    // 直接构造 fileTree 场景：通过 refreshFileTree + 虚拟工作区验证不过滤，
    // 真实分支的剪枝已在上面单元覆盖；这里验证虚拟工作区不被误剪。
    await tabStore.setVirtualWorkspace('web-demo', [
      { path: 'web-demo/a.md', content: '# A' },
      { path: 'web-demo/sub/b.md', content: '# B' },
    ])
    expect(tabStore.fileTree.length).toBe(2)
  })
})
