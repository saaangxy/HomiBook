import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// 安全存储:优先 expo-secure-store(真机加密存储);
// 运行环境不支持时(如旧版 Expo Go 缺新原生方法、web)自动降级 AsyncStorage,保证登录流程不被阻断
// 典型报错形态:ExpoSecureStore.default.setValueWithKeyAsync is not a function

export async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    await AsyncStorage.setItem(key, value).catch(() => {});
  }
}

export async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return await AsyncStorage.getItem(key).catch(() => null);
  }
}

export async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // SecureStore 不可用时走下面的 AsyncStorage 清理
  }
  await AsyncStorage.removeItem(key).catch(() => {});
}
