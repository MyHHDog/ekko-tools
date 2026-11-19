// install 生命周期只校验运行环境，绝不递归执行 npm。
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更新版本');
console.log('运行环境就绪；构建请执行 npm run build');
