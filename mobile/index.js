// 自定义入口(替代原来的 "main": "expo-router/entry")。
//
// 为什么要有这个文件:后台记账走 Headless JS —— 通知到达时原生会新建一个 JS 上下文
// 只执行 bundle 入口,不会挂载任何路由。若把注册放进 app/_layout.tsx,后台场景下
// 那个文件压根不会被求值,原生就会拿到 "task not found"。
//
// 顺序要求:先加载 expo-router(它负责 registerRootComponent),再注册 headless 任务。
import 'expo-router/entry';
import { registerAutoBookkeepingHeadlessTask } from './src/services/auto-background';

registerAutoBookkeepingHeadlessTask();
