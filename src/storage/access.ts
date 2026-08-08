import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_PIN_KEY = '@babyrecord/access-pin/v1';

export async function loadAccessPin() {
  try {
    return await AsyncStorage.getItem(ACCESS_PIN_KEY);
  } catch {
    return null;
  }
}

export async function saveAccessPin(pin: string) {
  await AsyncStorage.setItem(ACCESS_PIN_KEY, pin);
}

export async function clearAccessPin() {
  await AsyncStorage.removeItem(ACCESS_PIN_KEY);
}
