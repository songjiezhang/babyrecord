import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Keyboard,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DEFAULT_SYNC_ENDPOINT, DEFAULT_SYNC_PASSWORD, normalizeSyncEndpoint, verifyAdminPinWithServer } from './src/config/sync';
import { ANDROID_APK_NAME, APP_VERSION, androidApkDownloadUrl } from './src/config/update';
import {
  clearCurrentRole,
  DEFAULT_ROLES,
  loadRoleState,
  loadUserPreferences,
  saveCurrentRole,
  saveRoles,
  saveUserPreferences,
  type SavedRole,
} from './src/storage/roles';
import { createDailyBackup, ensureTodayBackup, loadBackups, type BackupPayload, type DailyBackup } from './src/storage/backups';
import { migrateEnvelope } from './src/data/schema';
import { generateTodaySuggestions } from './src/data/todoSuggestions';
import { loadSharedAppData, saveSharedAppData } from './src/storage/appData';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const C = {
  canvas: '#F7F6F2',
  paper: '#FFFFFF',
  ink: '#243044',
  muted: '#7C8797',
  line: '#E6E7E4',
  lavender: '#8778D9',
  lavenderSoft: '#EEEAFB',
  blue: '#5C8BC7',
  blueSoft: '#E8F1FA',
  peach: '#EA8D67',
  peachSoft: '#FBECE5',
  sage: '#69A58E',
  sageSoft: '#E6F3EE',
  amber: '#DBA33E',
  amberSoft: '#FBF2DC',
  pink: '#C87694',
  pinkSoft: '#F8E8EE',
  navy: '#25354E',
  danger: '#C85C5C',
};

const ElderModeContext = createContext(false);

function useElderMode() {
  return useContext(ElderModeContext);
}

function standardFontSize(size: number) {
  if (size >= 24) return Math.round(size * 1.05);
  if (size >= 18) return size + 1;
  if (size >= 12) return size + 2;
  return size + 1;
}

function elderFontSize(size: number) {
  const baseSize = standardFontSize(size);
  if (baseSize >= 28) return Math.round(baseSize * 1.18);
  if (baseSize >= 22) return Math.round(baseSize * 1.25);
  if (baseSize >= 17) return Math.round(baseSize * 1.35);
  return Math.max(18, Math.round(baseSize * 1.4));
}

function Text({ style, maxFontSizeMultiplier, ...props }: TextProps) {
  const elderMode = useElderMode();
  const flattened = StyleSheet.flatten(style);
  const scaledFontSize = flattened?.fontSize
    ? elderMode ? elderFontSize(flattened.fontSize) : standardFontSize(flattened.fontSize)
    : undefined;
  const scaledStyle = flattened?.fontSize && scaledFontSize
    ? {
        fontSize: scaledFontSize,
        lineHeight: flattened.lineHeight
          ? Math.round(flattened.lineHeight * (scaledFontSize / flattened.fontSize))
          : undefined,
      }
    : undefined;
  return <RNText {...props} style={[style, scaledStyle]} maxFontSizeMultiplier={maxFontSizeMultiplier} />;
}

function TextInput({ style, maxFontSizeMultiplier, ...props }: TextInputProps) {
  const elderMode = useElderMode();
  const flattened = StyleSheet.flatten(style);
  const scaledStyle = flattened?.fontSize
    ? { fontSize: elderMode ? elderFontSize(flattened.fontSize) : standardFontSize(flattened.fontSize) }
    : undefined;
  return <RNTextInput {...props} style={[style, scaledStyle]} maxFontSizeMultiplier={maxFontSizeMultiplier} />;
}

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
type RecordKind = 'sleep' | 'feed' | 'activity' | 'diaper' | 'supplement' | 'custom';
type TimeMode = 'instant' | 'range';
type TabKey = 'today' | 'calendar' | 'stats' | 'settings';

type RecordType = {
  key: RecordKind;
  label: string;
  icon: IconName;
  color: string;
  soft: string;
  timeMode: TimeMode;
};

type TimelineItem = {
  id: string;
  dateKey: string;
  kind: RecordKind;
  time: string;
  endTime?: string;
  title: string;
  detail: string;
  note?: string;
  ongoing?: boolean;
  timeMode?: TimeMode;
};

type CustomProject = {
  id: string;
  name: string;
  icon: IconName;
  color: string;
  soft: string;
  timeMode: TimeMode;
};

type TodoItem = {
  id: string;
  kind: RecordKind;
  time: string;
  title: string;
  reason: string;
  done: boolean;
};

type BabyProfile = {
  name: string;
  birthDate: string;
};

type QuickShortcutOption = {
  id: string;
  kind: RecordKind;
  label: string;
  icon: IconName;
  color: string;
  soft: string;
  customName?: string;
  timeMode: TimeMode;
};

type AddIntent = {
  kind: RecordKind;
  customName?: string;
  timeMode?: TimeMode;
};

const RECORD_TYPES: RecordType[] = [
  { key: 'sleep', label: '睡眠', icon: 'weather-night', color: C.lavender, soft: C.lavenderSoft, timeMode: 'range' },
  { key: 'feed', label: '喂奶', icon: 'baby-bottle-outline', color: C.blue, soft: C.blueSoft, timeMode: 'instant' },
  { key: 'activity', label: '活动', icon: 'teddy-bear', color: C.sage, soft: C.sageSoft, timeMode: 'range' },
  { key: 'diaper', label: '大小便', icon: 'baby-face-outline', color: C.amber, soft: C.amberSoft, timeMode: 'instant' },
  { key: 'supplement', label: '营养补充', icon: 'pill', color: C.peach, soft: C.peachSoft, timeMode: 'instant' },
  { key: 'custom', label: '自定义', icon: 'plus-circle-outline', color: C.pink, soft: C.pinkSoft, timeMode: 'instant' },
];

const BABY_PROJECT_ICONS: { name: IconName; label: string }[] = [
  { name: 'bowl-mix-outline', label: '辅食' },
  { name: 'bathtub-outline', label: '洗澡' },
  { name: 'thermometer', label: '体温' },
  { name: 'tooth-outline', label: '长牙' },
  { name: 'baby-carriage', label: '出门' },
  { name: 'book-open-variant', label: '阅读' },
  { name: 'music-note', label: '音乐' },
  { name: 'needle', label: '疫苗' },
  { name: 'medical-bag', label: '用药' },
  { name: 'shower', label: '护理' },
  { name: 'emoticon-happy-outline', label: '情绪' },
  { name: 'star-four-points-outline', label: '其他' },
];

const INITIAL_ITEMS: TimelineItem[] = [];
const INITIAL_TODOS: TodoItem[] = [];

function typeFor(kind: RecordKind): RecordType {
  return RECORD_TYPES.find((item) => item.key === kind) ?? RECORD_TYPES[5]!;
}

function timeModeFor(kind: RecordKind, customMode: TimeMode = 'instant'): TimeMode {
  return kind === 'custom' ? customMode : typeFor(kind).timeMode;
}

function isRangeItem(item: TimelineItem) {
  return item.timeMode === 'range' || item.kind === 'sleep' || item.kind === 'activity';
}

function shortcutOptions(customProjects: CustomProject[]): QuickShortcutOption[] {
  const builtIn = RECORD_TYPES.slice(0, 5).map((item) => ({
    id: `record:${item.key}`,
    kind: item.key,
    label: item.label,
    icon: item.icon,
    color: item.color,
    soft: item.soft,
    timeMode: item.timeMode,
  }));
  const custom = customProjects.map((item) => ({
    ...item,
    id: `custom:${item.id}`,
    kind: 'custom' as const,
    label: item.name,
    customName: item.name,
    timeMode: item.timeMode,
  }));
  return [...builtIn, ...custom];
}

function formatBirthDate(value: string) {
  if (!value) return '未设置出生日期';
  const [year, month, day] = value.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function addMonthsClamped(date: Date, months: number) {
  const targetMonthStart = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate();
  return new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), Math.min(date.getDate(), lastDay));
}

function babyAgeFromBirthDate(value: string, reference = new Date()) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return '年龄待计算';
  const birth = new Date(year, month - 1, day);
  let months = (reference.getFullYear() - birth.getFullYear()) * 12 + reference.getMonth() - birth.getMonth();
  let monthAnchor = addMonthsClamped(birth, months);
  if (monthAnchor > reference) {
    months -= 1;
    monthAnchor = addMonthsClamped(birth, months);
  }
  const days = Math.max(0, Math.floor((new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime() - monthAnchor.getTime()) / 86400000));
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return years > 0 ? `${years}岁 ${remainingMonths}个月 ${days}天` : `${remainingMonths}个月 ${days}天`;
}

function nowTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1, 12);
}

function chineseWeekday(value: string) {
  return ['日', '一', '二', '三', '四', '五', '六'][dateFromKey(value).getDay()] ?? '';
}

function dateTitle(value: string) {
  const date = dateFromKey(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function fullDateTitle(value: string) {
  const date = dateFromKey(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function durationBetween(start: string, end: string) {
  let minutes = minuteOfDay(end) - minuteOfDay(start);
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

function sleepDurationText(start: string, end: string) {
  const total = durationBetween(start, end);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分`;
}

function rangeEndMinute(item: TimelineItem, currentTime = nowTime()) {
  const start = minuteOfDay(item.time);
  let end = minuteOfDay(item.endTime ?? (item.ongoing ? currentTime : item.time));
  if (end < start) end += 24 * 60;
  return end;
}

function rangesOverlap(first: TimelineItem, second: TimelineItem, currentTime = nowTime()) {
  if (!isRangeItem(first) || !isRangeItem(second)) return false;
  const firstStart = minuteOfDay(first.time);
  const firstEnd = rangeEndMinute(first, currentTime);
  const secondStart = minuteOfDay(second.time);
  const secondEnd = rangeEndMinute(second, currentTime);
  return [-24 * 60, 0, 24 * 60].some((shift) => firstStart < secondEnd + shift && firstEnd > secondStart + shift);
}

function findRangeConflict(candidate: TimelineItem, items: TimelineItem[]) {
  if (!isRangeItem(candidate)) return undefined;
  return items.find((item) => item.id !== candidate.id && isRangeItem(item) && rangesOverlap(candidate, item));
}

function pointFallsInsideRange(pointTime: string, range: TimelineItem, currentTime = nowTime()) {
  if (!isRangeItem(range)) return false;
  const point = minuteOfDay(pointTime);
  const start = minuteOfDay(range.time);
  const end = rangeEndMinute(range, currentTime);
  return [-24 * 60, 0, 24 * 60].some((shift) => point >= start + shift && point <= end + shift);
}

function Icon({ name, size = 20, color = C.ink }: { name: IconName; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

function StableKeyboardRoot({ style, children }: React.PropsWithChildren<{ style?: any }>) {
  if (Platform.OS === 'ios') {
    return <KeyboardAvoidingView style={style} behavior="padding">{children}</KeyboardAvoidingView>;
  }
  return <View style={style}>{children}</View>;
}

function roleIcon(role: SavedRole): IconName {
  if (role.isAdmin) return 'shield-account-outline';
  if (role.name.includes('妈妈') || role.name.includes('奶奶') || role.name.includes('外婆')) return 'face-woman-outline';
  if (role.name.includes('爸爸') || role.name.includes('爷爷') || role.name.includes('外公')) return 'face-man-outline';
  return 'account-heart-outline';
}

function RoleLoadingScreen() {
  return (
    <SafeAreaView style={styles.roleSafe}>
      <StatusBar style="dark" />
      <View style={styles.roleLoading}>
        <View style={styles.roleBrandIcon}><Icon name="baby-face-outline" size={35} color={C.peach} /></View>
        <Text style={styles.roleBrandName}>宝宝日记</Text>
        <ActivityIndicator style={{ marginTop: 18 }} color={C.navy} />
      </View>
    </SafeAreaView>
  );
}

function RoleSetupScreen({ roles, onComplete, onVerifyAdminPin }: { roles: SavedRole[]; onComplete: (role: SavedRole) => Promise<void>; onVerifyAdminPin: (pin: string) => Promise<boolean> }) {
  const [pin, setPin] = useState('');
  const [pendingAdminRole, setPendingAdminRole] = useState<SavedRole | null>(null);
  const [customName, setCustomName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const finishRole = async (role: SavedRole) => {
    setSaving(true);
    await onComplete(role);
    setSaving(false);
  };

  const chooseRole = (role: SavedRole) => {
    if (role.isAdmin) {
      setPendingAdminRole(role);
      setPin('');
      setError('');
      return;
    }
    finishRole(role);
  };

  const verifyAdminPin = async () => {
    if (!pendingAdminRole) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      if (!await onVerifyAdminPin(pin)) {
        setError('管理员 PIN 不正确');
        return;
      }
      await onComplete(pendingAdminRole);
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法连接认证服务');
    } finally {
      setSaving(false);
    }
  };

  const createCustomRole = () => {
    const name = customName.trim();
    if (!name) return;
    Keyboard.dismiss();
    finishRole({ id: `family:${Date.now()}`, name, isAdmin: false, createdAt: new Date().toISOString() });
  };

  const closeAdminPin = () => {
    Keyboard.dismiss();
    setPendingAdminRole(null);
  };

  return (
    <SafeAreaView style={styles.roleSafe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.rolePage} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.roleBrandRow}>
          <View style={styles.roleBrandIcon}><Icon name="baby-face-outline" size={31} color={C.peach} /></View>
          <View><Text style={styles.roleBrandName}>宝宝日记</Text><Text style={styles.roleBrandSubtitle}>选择当前使用者</Text></View>
        </View>
        <View style={styles.roleSelectCard}>
          <View style={styles.roleStepBadge}><Text style={styles.roleStepText}>首次设置</Text></View>
          <Text style={styles.roleTitle}>你是谁？</Text>
          <Text style={styles.roleDescription}>选择角色后会自动保存在本设备。爸爸、妈妈是管理员角色，需要验证 PIN。</Text>
          <View style={styles.roleGrid}>
            {roles.map((role) => (
              <TouchableOpacity key={role.id} style={styles.roleChoiceCard} onPress={() => chooseRole(role)} activeOpacity={0.76} disabled={saving}>
                <View style={[styles.roleChoiceIcon, role.isAdmin && { backgroundColor: C.peachSoft }]}><Icon name={roleIcon(role)} size={24} color={role.isAdmin ? C.peach : C.sage} /></View>
                <View style={styles.roleChoiceCopy}>
                  <Text style={styles.roleChoiceName}>{role.name}</Text>
                  <Text style={styles.roleChoiceMeta}>{role.isAdmin ? '管理员 · 需要 PIN' : '家庭成员'}</Text>
                </View>
                <Icon name="chevron-right" size={19} color="#A8AFB7" />
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.roleOrRow}><View style={styles.roleOrLine} /><Text style={styles.roleOrText}>或者自定义普通角色</Text><View style={styles.roleOrLine} /></View>
          <Field label="角色名称">
            <TextInput value={customName} onChangeText={setCustomName} style={styles.input} placeholder="例如：奶奶、外公、月嫂" placeholderTextColor="#A6ADB6" maxLength={12} />
          </Field>
          <TouchableOpacity style={[styles.rolePrimaryButton, !customName.trim() && styles.roleButtonDisabled]} disabled={!customName.trim() || saving} onPress={createCustomRole} activeOpacity={0.82}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <><Icon name="account-plus-outline" size={20} color="#FFFFFF" /><Text style={styles.rolePrimaryButtonText}>创建并进入</Text></>}
          </TouchableOpacity>
          <Text style={styles.roleAutoSaveText}>角色保存后，下次打开无需再次选择或输入 PIN。</Text>
        </View>
      </ScrollView>

      {pendingAdminRole && <Modal visible transparent animationType="fade" statusBarTranslucent hardwareAccelerated onRequestClose={closeAdminPin}>
        <StableKeyboardRoot style={styles.adminPinModalRoot}>
          <Pressable style={styles.wheelBackdrop} onPress={closeAdminPin} />
          <View style={styles.adminPinCard}>
            <View style={styles.adminPinIcon}><Icon name="shield-lock-outline" size={31} color={C.peach} /></View>
            <Text style={styles.adminPinTitle}>验证管理员身份</Text>
            <Text style={styles.adminPinDescription}>请输入“{pendingAdminRole?.name}”的 4–8 位管理员 PIN。</Text>
            <View style={[styles.pinInputWrap, !!error && styles.pinInputError]}>
              <Icon name="lock-outline" size={21} color={error ? C.danger : C.navy} />
              <TextInput value={pin} onChangeText={(value) => { setPin(value.replace(/\D/g, '').slice(0, 8)); setError(''); }} style={styles.pinInput} keyboardType="number-pad" secureTextEntry maxLength={8} placeholder="4–8 位 PIN" placeholderTextColor="#A6ADB6" autoFocus onSubmitEditing={verifyAdminPin} />
              <Text style={styles.pinCount}>{pin.length}/8</Text>
            </View>
            {!!error && <Text style={styles.pinErrorText}>{error}</Text>}
            <TouchableOpacity style={[styles.rolePrimaryButton, pin.length < 4 && styles.roleButtonDisabled]} disabled={pin.length < 4 || saving} onPress={verifyAdminPin}>
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <><Text style={styles.rolePrimaryButtonText}>验证并进入</Text><Icon name="arrow-right" size={20} color="#FFFFFF" /></>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.adminPinCancel} onPress={closeAdminPin}><Text style={styles.adminPinCancelText}>取消</Text></TouchableOpacity>
          </View>
        </StableKeyboardRoot>
      </Modal>}
    </SafeAreaView>
  );
}

export default function App() {
  const [roleReady, setRoleReady] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [currentRole, setCurrentRole] = useState<SavedRole | null>(null);
  const [roles, setRoles] = useState<SavedRole[]>(DEFAULT_ROLES);
  const [roleManagementOpen, setRoleManagementOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backups, setBackups] = useState<DailyBackup[]>([]);
  const [tab, setTab] = useState<TabKey>('today');
  const [selectedDateKey, setSelectedDateKey] = useState(localDateKey());
  const [items, setItems] = useState<TimelineItem[]>(INITIAL_ITEMS);
  const [addOpen, setAddOpen] = useState(false);
  const [addIntent, setAddIntent] = useState<AddIntent | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [babyProfileOpen, setBabyProfileOpen] = useState(false);
  const [syncEndpointOpen, setSyncEndpointOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TimelineItem | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>(INITIAL_TODOS);
  const [todoDraft, setTodoDraft] = useState<TodoItem | null>(null);
  const [toast, setToast] = useState('');
  const [elderMode, setElderMode] = useState(false);
  const [babyProfile, setBabyProfile] = useState<BabyProfile>({ name: '宝宝', birthDate: '' });
  const [syncEndpoint, setSyncEndpoint] = useState(Platform.OS === 'web' ? '/sync' : DEFAULT_SYNC_ENDPOINT);
  const [syncPassword, setSyncPassword] = useState(DEFAULT_SYNC_PASSWORD);
  const [quickShortcutIds, setQuickShortcutIds] = useState(['record:sleep', 'record:feed', 'record:diaper', 'record:supplement']);
  const [customProjects, setCustomProjects] = useState<CustomProject[]>([]);

  useEffect(() => {
    let active = true;
    loadRoleState().then(({ currentRole: savedRole, roles: savedRoles }) => {
      if (!active) return;
      setCurrentRole(savedRole);
      setRoles(savedRoles);
      setRoleReady(true);
      if (!savedRole) setPreferencesReady(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    loadSharedAppData().then((data) => {
      if (!active) return;
      if (data) {
        setItems(data.items as TimelineItem[]);
        setTodos(data.todos as TodoItem[]);
        setBabyProfile(data.babyProfile);
        setCustomProjects(data.customProjects as CustomProject[]);
      }
      setDataReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!dataReady) return;
    saveSharedAppData({ items, todos, babyProfile, customProjects }).catch(() => undefined);
  }, [dataReady, items, todos, babyProfile, customProjects]);

  useEffect(() => {
    if (!currentRole) return;
    let active = true;
    setPreferencesReady(false);
    loadUserPreferences(currentRole.id).then((preferences) => {
      if (!active) return;
      setElderMode(preferences?.elderMode ?? false);
      setQuickShortcutIds(preferences?.quickShortcutIds ?? ['record:sleep', 'record:feed', 'record:diaper', 'record:supplement']);
      if (Platform.OS !== 'web') {
        setSyncEndpoint(preferences?.syncEndpoint ?? DEFAULT_SYNC_ENDPOINT);
        setSyncPassword(preferences?.syncPassword ?? DEFAULT_SYNC_PASSWORD);
      }
      setPreferencesReady(true);
    });
    return () => { active = false; };
  }, [currentRole?.id]);

  useEffect(() => {
    if (!currentRole || !preferencesReady || !dataReady) return;
    saveUserPreferences({
      userId: currentRole.id,
      quickShortcutIds,
      elderMode,
      syncEndpoint: Platform.OS === 'web' ? undefined : syncEndpoint,
      syncPassword: Platform.OS === 'web' ? undefined : syncPassword,
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
  }, [currentRole, preferencesReady, dataReady, quickShortcutIds, elderMode, syncEndpoint, syncPassword]);

  const makeBackupPayload = (): BackupPayload => ({
    items,
    todos,
    babyProfile,
    customProjects,
    syncEndpoint,
    roles,
  });
  const backupPayloadRef = React.useRef<BackupPayload>(makeBackupPayload());
  backupPayloadRef.current = makeBackupPayload();

  useEffect(() => {
    if (!currentRole || !preferencesReady || !dataReady) return;
    const runDailyBackupCheck = () => ensureTodayBackup(backupPayloadRef.current).then(setBackups).catch(() => undefined);
    runDailyBackupCheck();
    const timer = setInterval(runDailyBackupCheck, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [currentRole?.id, preferencesReady, dataReady]);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 2200);
  };

  const selectedItems = useMemo(
    () => items.filter((item) => item.dateKey === selectedDateKey).sort((a, b) => a.time.localeCompare(b.time)),
    [items, selectedDateKey],
  );
  const todayTodos = useMemo(() => {
    const suggested = generateTodaySuggestions(items, localDateKey());
    const savedIds = new Set(todos.map((todo) => todo.id));
    return [...todos, ...suggested.filter((todo) => !savedIds.has(todo.id))].sort((a, b) => a.time.localeCompare(b.time));
  }, [items, todos]);

  const handleSave = (item: TimelineItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItems((current) => [item, ...current].sort((a, b) => a.time.localeCompare(b.time)));
    if (todoDraft) {
      setTodos((current) => current.map((todo) => todo.id === todoDraft.id ? { ...todo, done: true } : todo));
      setTodoDraft(null);
    }
    setAddOpen(false);
    setAddIntent(null);
    showToast(selectedDateKey === localDateKey() ? '记录已添加到今天' : `记录已添加到${dateTitle(selectedDateKey)}`);
  };

  const stopRecord = (id: string, selectedEndTime = nowTime()) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItems((current) => current.map((item) => item.id === id ? { ...item, ongoing: false, endTime: selectedEndTime, detail: sleepDurationText(item.time, selectedEndTime) } : item));
    showToast(`记录已结束 · ${selectedEndTime}`);
  };

  const completeRoleSetup = async (role: SavedRole) => {
    try {
      if (!roles.some((item) => item.id === role.id)) {
        const nextRoles = [...roles, role];
        await saveRoles(nextRoles);
        setRoles(nextRoles);
      }
      await saveCurrentRole(role);
      setCurrentRole(role);
    } catch {
      Alert.alert('无法保存角色', '请检查设备存储权限后重试。');
    }
  };

  if (!roleReady || !dataReady || (currentRole && !preferencesReady)) {
    return (
      <ElderModeContext.Provider value={elderMode}>
        <RoleLoadingScreen />
      </ElderModeContext.Provider>
    );
  }

  if (!currentRole) {
    return (
      <ElderModeContext.Provider value={false}>
        <RoleSetupScreen roles={roles} onComplete={completeRoleSetup} onVerifyAdminPin={(pin) => verifyAdminPinWithServer(pin, syncEndpoint)} />
      </ElderModeContext.Provider>
    );
  }

  return (
    <ElderModeContext.Provider value={elderMode}>
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.app}>
        {tab === 'today' && (
          <TodayScreen
            selectedDateKey={selectedDateKey}
            items={selectedItems}
            todos={todayTodos}
            customProjects={customProjects}
            quickShortcutIds={quickShortcutIds}
            onAdd={() => {
              setAddIntent(null);
              setAddOpen(true);
            }}
            onQuickAdd={(intent) => {
              setAddIntent(intent);
              setAddOpen(true);
            }}
            onEdit={setEditingItem}
            onStopRecord={stopRecord}
            onOpenCalendar={() => setTab('calendar')}
            onOpenTodo={(todo) => {
              setTodoDraft(todo);
              setAddOpen(true);
            }}
          />
        )}
        {tab === 'calendar' && (
          <CalendarScreen
            selectedDateKey={selectedDateKey}
            onSelectDate={setSelectedDateKey}
            items={items}
            onOpenDay={() => setTab('today')}
            babyProfile={babyProfile}
          />
        )}
        {tab === 'stats' && <StatsScreen items={items} babyProfile={babyProfile} />}
        {tab === 'settings' && (
          <SettingsScreen
            customProjects={customProjects}
            onAdd={() => setProjectOpen(true)}
            babyProfile={babyProfile}
            onEditBabyProfile={() => setBabyProfileOpen(true)}
            currentRole={currentRole}
            roles={roles}
            onManageRoles={() => setRoleManagementOpen(true)}
            backupCount={backups.length}
            onOpenBackups={async () => {
              setBackups(await loadBackups());
              setBackupOpen(true);
            }}
            onSwitchRole={async () => {
              await clearCurrentRole();
              setPreferencesReady(false);
              setCurrentRole(null);
              setSelectedDateKey(localDateKey());
              setTab('today');
            }}
            quickShortcutIds={quickShortcutIds}
            onToggleQuickShortcut={(id) => {
              setQuickShortcutIds((current) => {
                if (current.includes(id)) return current.filter((item) => item !== id);
                if (current.length >= 4) {
                  showToast('主页最多显示 4 个快捷项');
                  return current;
                }
                return [...current, id];
              });
            }}
            syncEndpoint={syncEndpoint}
            syncPasswordConfigured={!!syncPassword}
            onEditSyncEndpoint={() => setSyncEndpointOpen(true)}
            onDownloadAndroid={async () => {
              const url = androidApkDownloadUrl();
              if (!url) {
                Alert.alert('尚未配置下载地址', '请在构建环境中设置 GitHub 仓库和下载代理地址。');
                return;
              }
              await Linking.openURL(url);
            }}
            onExport={() => showToast('已准备导出 JSON / CSV')}
            elderMode={elderMode}
            onChangeElderMode={(enabled) => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setElderMode(enabled);
              showToast(enabled ? '长辈模式已开启' : '已恢复标准字号');
            }}
          />
        )}
        <BottomTabs active={tab} onChange={(nextTab) => {
          if (nextTab === 'today') setSelectedDateKey(localDateKey());
          setTab(nextTab);
        }} />
        {toast ? (
          <View style={styles.toast}>
            <Icon name="check-circle" size={18} color="#FFFFFF" />
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}
      </View>

      {addOpen && <AddRecordSheet
        key={addOpen ? `open:${todoDraft?.id ?? `${addIntent?.kind ?? 'picker'}:${addIntent?.customName ?? ''}`}` : 'closed'}
        visible
        preset={todoDraft}
        initialKind={addIntent?.kind}
        initialCustomName={addIntent?.customName}
        initialTimeMode={addIntent?.timeMode}
        customProjects={customProjects}
        existingItems={selectedItems}
        targetDateKey={selectedDateKey}
        onClose={() => {
          setAddOpen(false);
          setTodoDraft(null);
          setAddIntent(null);
        }}
        onSave={handleSave}
      />}
      {babyProfileOpen && <BabyProfileSheet
        visible
        profile={babyProfile}
        onClose={() => setBabyProfileOpen(false)}
        onSave={(profile) => {
          setBabyProfile(profile);
          setBabyProfileOpen(false);
          showToast('宝宝资料已更新');
        }}
      />}
      {Platform.OS !== 'web' && syncEndpointOpen && (
        <SyncEndpointSheet
          endpoint={syncEndpoint}
          password={syncPassword}
          onClose={() => setSyncEndpointOpen(false)}
          onSave={(endpoint, password) => {
            setSyncEndpoint(normalizeSyncEndpoint(endpoint));
            setSyncPassword(password);
            setSyncEndpointOpen(false);
            showToast('同步接口已保存');
          }}
        />
      )}
      {roleManagementOpen && <RoleManagementSheet
        visible
        roles={roles}
        currentRole={currentRole}
        onClose={() => setRoleManagementOpen(false)}
        onSave={async (nextRoles) => {
          const updatedCurrent = nextRoles.find((role) => role.id === currentRole.id) ?? currentRole;
          await saveRoles(nextRoles);
          await saveCurrentRole(updatedCurrent);
          setRoles(nextRoles);
          setCurrentRole(updatedCurrent);
          setRoleManagementOpen(false);
          showToast('用户与权限已更新');
        }}
      />}
      {backupOpen && <BackupRestoreSheet
        visible
        backups={backups}
        onClose={() => setBackupOpen(false)}
        onBackupNow={async () => {
          const next = await createDailyBackup(makeBackupPayload(), true);
          setBackups(next);
          showToast('今日备份已更新');
        }}
        onRestore={async (backup) => {
          const payload = migrateEnvelope({ schemaVersion: backup.schemaVersion, exportedAt: backup.createdAt, payload: backup.payload }).payload as BackupPayload;
          setItems(payload.items as TimelineItem[]);
          setTodos(payload.todos as TodoItem[]);
          setBabyProfile(payload.babyProfile);
          setCustomProjects(payload.customProjects as CustomProject[]);
          setSyncEndpoint(Platform.OS === 'web' ? '/sync' : payload.syncEndpoint);
          const restoredRoles = payload.roles.some((role) => role.id === currentRole.id) ? payload.roles : [...payload.roles, currentRole];
          setRoles(restoredRoles);
          await saveRoles(restoredRoles);
          setBackupOpen(false);
          showToast(`已恢复 ${backup.localDate} 的备份`);
        }}
      />}
      {projectOpen && <ProjectSheet
        visible
        onClose={() => setProjectOpen(false)}
        onSave={(project) => {
          setCustomProjects((current) => [...current, project]);
          setQuickShortcutIds((current) => [...current.filter((id) => id !== `custom:${project.id}`).slice(0, 3), `custom:${project.id}`]);
          setProjectOpen(false);
          setSelectedDateKey(localDateKey());
          setTab('today');
          showToast(`“${project.name}”已创建并显示在主页`);
        }}
      />}
      {editingItem && <RecordDetailSheet
        key={editingItem?.id ?? 'closed-record'}
        item={editingItem}
        existingItems={editingItem ? items.filter((item) => item.dateKey === editingItem.dateKey) : []}
        onClose={() => setEditingItem(null)}
        onSave={(updated) => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setItems((current) => current.map((item) => item.id === updated.id ? updated : item).sort((a, b) => a.time.localeCompare(b.time)));
          setEditingItem(null);
          showToast('记录已更新');
        }}
        onDelete={() => {
          if (!editingItem) return;
          setItems((current) => current.filter((item) => item.id !== editingItem.id));
          setEditingItem(null);
          showToast('记录已删除');
        }}
      />}
    </SafeAreaView>
    </ElderModeContext.Provider>
  );
}

function TodayScreen({
  selectedDateKey,
  items,
  todos,
  customProjects,
  quickShortcutIds,
  onAdd,
  onQuickAdd,
  onEdit,
  onStopRecord,
  onOpenCalendar,
  onOpenTodo,
}: {
  selectedDateKey: string;
  items: TimelineItem[];
  todos: TodoItem[];
  customProjects: CustomProject[];
  quickShortcutIds: string[];
  onAdd: () => void;
  onQuickAdd: (intent: AddIntent) => void;
  onEdit: (item: TimelineItem) => void;
  onStopRecord: (id: string, endTime?: string) => void;
  onOpenCalendar: () => void;
  onOpenTodo: (todo: TodoItem) => void;
}) {
  const elderMode = useElderMode();
  const isToday = selectedDateKey === localDateKey();
  return (
    <View style={styles.screen}>
      <View style={[styles.todayContent, elderMode && styles.todayContentElder]}>
        <View style={styles.todayTopBar}>
          <View>
            <Text style={styles.todayTitle}>{isToday ? '今天' : dateTitle(selectedDateKey)}</Text>
            <Text style={styles.todaySubtitle}>{fullDateTitle(selectedDateKey)} · 星期{chineseWeekday(selectedDateKey)}</Text>
          </View>
          <TouchableOpacity style={styles.calendarEntryButton} onPress={onOpenCalendar} activeOpacity={0.72}>
            <Icon name="calendar-month-outline" size={19} color={C.navy} />
            <Text style={styles.calendarEntryText}>日历</Text>
          </TouchableOpacity>
        </View>
        {items.length || (isToday && todos.length) ? (
          <View style={styles.todayMain}>
            {isToday && <OngoingRecords items={items.filter((item) => item.ongoing)} onStop={onStopRecord} />}
            {isToday && <TodayTodos todos={todos} onOpen={onOpenTodo} />}
            <View style={styles.calendarHeading}>
              <View style={styles.calendarTitleRow}>
                <Text style={styles.calendarTitle}>{isToday ? '今日时间表' : `${dateTitle(selectedDateKey)}时间表`}</Text>
                <View style={styles.recordCountBadge}><Text style={styles.recordCountText}>{items.length} 条</Text></View>
              </View>
              <Text style={styles.calendarHint}>线标记时刻 · 色块表示时间段</Text>
            </View>
            {items.length ? <CalendarTimeline items={items} onEdit={onEdit} showCurrentTime={isToday} /> : <EmptyDay day={dateTitle(selectedDateKey)} onAdd={onAdd} />}
          </View>
        ) : (
          <EmptyDay day={dateTitle(selectedDateKey)} onAdd={onAdd} />
        )}
      </View>
      <QuickAddBar
        shortcuts={shortcutOptions(customProjects).filter((item) => quickShortcutIds.includes(item.id))}
        onAdd={onAdd}
        onQuickAdd={onQuickAdd}
      />
    </View>
  );
}

function Header({ babyProfile }: { babyProfile: BabyProfile }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.babySwitcher} activeOpacity={0.75}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{babyProfile.name.slice(-1)}</Text></View>
        <View>
          <Text style={styles.babyName}>{babyProfile.name}</Text>
          <Text style={styles.babyAge}>{babyAgeFromBirthDate(babyProfile.birthDate)} · 根据出生日期计算</Text>
        </View>
        <Icon name="chevron-down" size={18} color={C.muted} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.roundButton} activeOpacity={0.72}>
        <Icon name="bell-outline" size={22} color={C.ink} />
        <View style={styles.notificationDot} />
      </TouchableOpacity>
    </View>
  );
}

function TodayTodos({ todos, onOpen }: { todos: TodoItem[]; onOpen: (todo: TodoItem) => void }) {
  const elderMode = useElderMode();
  const [expanded, setExpanded] = useState(false);
  const completed = todos.filter((todo) => todo.done).length;
  const pendingTodo = todos.find((todo) => !todo.done);
  const nextTodo = pendingTodo ?? todos[0];
  const visibleTodos = expanded ? todos : nextTodo ? [nextTodo] : [];
  if (!todos.length) return null;
  return (
    <View style={[styles.todoPanel, elderMode && styles.todoPanelElder, !expanded && styles.todoPanelCollapsed, elderMode && !expanded && styles.todoPanelCollapsedElder]}>
      <TouchableOpacity style={[styles.todoHeader, elderMode && styles.todoHeaderElder]} activeOpacity={0.72} onPress={() => setExpanded((current) => !current)}>
        <View style={styles.todoTitleRow}>
          <View style={[styles.todoSpark, elderMode && styles.todoSparkElder]}><Icon name="creation" size={elderMode ? 22 : 15} color={C.peach} /></View>
          <Text style={styles.todoTitle}>今日待办</Text>
          <Text style={styles.todoProgress}>{completed}/{todos.length}</Text>
        </View>
        <View style={[styles.todoCollapseMeta, elderMode && styles.todoCollapseMetaElder]}>
          <Text style={styles.todoSource}>{expanded ? '按最近 7 天规律生成' : pendingTodo ? `下一项 ${pendingTodo.time}` : '今日已完成'}</Text>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={elderMode ? 22 : 16} color={C.muted} />
        </View>
      </TouchableOpacity>
      <View style={styles.todoRows}>
        {visibleTodos.map((todo) => {
          const type = typeFor(todo.kind);
          return (
            <TouchableOpacity key={todo.id} style={[styles.todoRow, elderMode && styles.todoRowElder]} activeOpacity={0.72} onPress={() => onOpen(todo)} disabled={todo.done}>
              <View style={[styles.todoLeading, elderMode && styles.todoLeadingElder]}>
                <View style={[styles.todoCheck, elderMode && styles.todoCheckElder, todo.done && { backgroundColor: type.color, borderColor: type.color }]}>
                  {todo.done && <Icon name="check" size={elderMode ? 17 : 12} color="#FFFFFF" />}
                </View>
                <View style={[styles.todoTypeDot, elderMode && styles.todoTypeDotElder, { backgroundColor: type.soft }]}><Icon name={type.icon} size={elderMode ? 22 : 14} color={type.color} /></View>
              </View>
              {!elderMode && <Text style={styles.todoTime}>{todo.time}</Text>}
              <View style={[styles.todoCopy, elderMode && styles.todoCopyElder]}>
                {elderMode && <Text style={styles.todoTimeElder}>{todo.time}</Text>}
                <Text numberOfLines={elderMode ? undefined : 1} style={[styles.todoName, todo.done && styles.todoTextDone]}>{todo.title}</Text>
                <Text numberOfLines={elderMode ? undefined : 1} style={styles.todoReason}>{todo.reason}</Text>
              </View>
              {!todo.done && <Icon name="chevron-right" size={elderMode ? 24 : 15} color="#A8AFB7" />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function OngoingRecords({ items, onStop }: { items: TimelineItem[]; onStop: (id: string, endTime?: string) => void }) {
  const [selectingItem, setSelectingItem] = useState<TimelineItem | null>(null);
  const [clock, setClock] = useState(nowTime());
  useEffect(() => {
    const timer = setInterval(() => setClock(nowTime()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);
  if (!items.length) return null;
  return (
    <View style={styles.ongoingPanel}>
      <View style={styles.ongoingHeader}>
        <View style={styles.ongoingTitleRow}>
          <View style={styles.ongoingPulse} />
          <Text style={styles.ongoingTitle}>进行中</Text>
        </View>
        <Text style={styles.ongoingCount}>{items.length} 项</Text>
      </View>
      {items.map((item) => {
        const type = typeFor(item.kind);
        return (
          <View key={item.id} style={[styles.ongoingCard, { borderLeftColor: type.color }]}>
            <View style={[styles.ongoingIcon, { backgroundColor: type.soft }]}><Icon name={type.icon} size={19} color={type.color} /></View>
            <View style={styles.ongoingCopy}>
              <Text numberOfLines={1} style={styles.ongoingName}>{item.title}</Text>
              <Text style={styles.ongoingMeta}>{item.time} 开始 · 已进行 {sleepDurationText(item.time, clock)}</Text>
            </View>
            <TouchableOpacity style={styles.ongoingChooseButton} onPress={() => setSelectingItem(item)} activeOpacity={0.72} accessibilityLabel="选择结束时间">
              <Icon name="clock-edit-outline" size={15} color={type.color} />
              <Text style={[styles.ongoingChooseText, { color: type.color }]}>选时间</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.ongoingNowButton, { backgroundColor: type.color }]} onPress={() => onStop(item.id)} activeOpacity={0.76}>
              <Icon name="stop" size={15} color="#FFFFFF" />
              <Text style={styles.ongoingNowText}>现在结束</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      <WheelTimePicker
        visible={!!selectingItem}
        value={clock}
        color={typeFor(selectingItem?.kind ?? 'custom').color}
        onClose={() => setSelectingItem(null)}
        onChange={(value) => {
          if (selectingItem) onStop(selectingItem.id, value);
          setSelectingItem(null);
        }}
      />
    </View>
  );
}

const CALENDAR_START_MINUTE = 0;
const CALENDAR_END_MINUTE = 24 * 60;
const CALENDAR_HOURS = Array.from({ length: 25 }, (_, index) => index);
const CALENDAR_HOUR_HEIGHT = 58;

function minuteOfDay(time: string) {
  const [hour = '0', minute = '0'] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}

function CalendarTimeline({ items, onEdit, showCurrentTime }: { items: TimelineItem[]; onEdit: (item: TimelineItem) => void; showCurrentTime: boolean }) {
  const elderMode = useElderMode();
  const [clock, setClock] = useState(nowTime());
  const scrollRef = React.useRef<ScrollView>(null);
  const span = CALENDAR_END_MINUTE - CALENDAR_START_MINUTE;
  const hourHeight = elderMode ? 96 : CALENDAR_HOUR_HEIGHT;
  const scrollHeight = (CALENDAR_HOURS.length - 1) * hourHeight;
  const visibleItems = items.filter((item) => {
    const minute = minuteOfDay(item.time);
    return minute >= CALENDAR_START_MINUTE && minute <= CALENDAR_END_MINUTE;
  });
  const currentMinute = minuteOfDay(clock);
  const nowTop = ((currentMinute - CALENDAR_START_MINUTE) / span) * 100;
  const firstItemMinute = visibleItems.length ? Math.min(...visibleItems.map((item) => minuteOfDay(item.time))) : 0;

  useEffect(() => {
    if (!showCurrentTime) return undefined;
    const timer = setInterval(() => setClock(nowTime()), 30 * 1000);
    return () => clearInterval(timer);
  }, [showCurrentTime]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const targetMinute = showCurrentTime ? minuteOfDay(nowTime()) : firstItemMinute;
      const targetY = ((targetMinute - CALENDAR_START_MINUTE) / span) * scrollHeight;
      scrollRef.current?.scrollTo({ y: Math.max(0, targetY - 110), animated: false });
    }, 80);
    return () => clearTimeout(timer);
  }, [hourHeight, items.length, firstItemMinute, showCurrentTime]);

  return (
    <View style={styles.calendarGrid}>
      <ScrollView ref={scrollRef} style={styles.calendarScroll} contentContainerStyle={styles.calendarScrollContent} showsVerticalScrollIndicator nestedScrollEnabled>
        <View style={[styles.calendarScrollable, { height: scrollHeight }]}>
          <View style={[styles.calendarAxis, elderMode && styles.calendarAxisElder]}>
            {CALENDAR_HOURS.map((hour, index) => (
              <Text key={hour} style={[styles.calendarHour, elderMode && styles.calendarHourElder, { top: `${(index / (CALENDAR_HOURS.length - 1)) * 100}%` }]}>{String(hour).padStart(2, '0')}:00</Text>
            ))}
          </View>
          <View style={styles.calendarCanvas}>
            {CALENDAR_HOURS.map((hour, index) => (
              <View key={hour} style={[styles.calendarLine, { top: `${(index / (CALENDAR_HOURS.length - 1)) * 100}%` }]} />
            ))}
            {showCurrentTime && (
              <View style={[styles.nowLine, { top: `${nowTop}%` }]}>
                <View style={styles.nowDot} />
                <Text numberOfLines={1} style={styles.nowLabel}>现在 {clock}</Text>
                <View style={styles.nowRule} />
              </View>
            )}
            {visibleItems.map((item) => {
              const type = typeFor(item.kind);
              const rangeItem = isRangeItem(item);
              const instantOverlapsRange = !rangeItem && items.some((other) => other.id !== item.id && isRangeItem(other) && pointFallsInsideRange(item.time, other, clock));
              const start = minuteOfDay(item.time);
              const fallbackEnd = showCurrentTime && item.ongoing && currentMinute > start ? currentMinute : start + 40;
              let end = item.endTime ? minuteOfDay(item.endTime) : fallbackEnd;
              if (end < start) end += 24 * 60;
              const top = Math.max(0, ((start - CALENDAR_START_MINUTE) / span) * 100);
              const rawHeight = ((Math.max(20, end - start) / span) * 100);
              const height = Math.max(3.2, rawHeight);
              if (!rangeItem) {
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => onEdit(item)}
                    style={({ pressed }) => [
                      styles.calendarInstantEvent,
                      elderMode && styles.calendarInstantEventElder,
                      instantOverlapsRange && styles.calendarInstantEventBent,
                      elderMode && instantOverlapsRange && styles.calendarInstantEventBentElder,
                      { top: `${top}%` },
                      pressed && styles.calendarEventPressed,
                    ]}
                  >
                    <View style={[styles.calendarInstantMarker, elderMode && styles.calendarInstantMarkerElder, { backgroundColor: type.color }]} />
                    {instantOverlapsRange ? (
                      <View style={[styles.calendarBentConnector, elderMode && styles.calendarBentConnectorElder]}>
                        <View style={[styles.calendarBendTop, { backgroundColor: `${type.color}88` }]} />
                        <View style={[styles.calendarBendVertical, { backgroundColor: `${type.color}88` }]} />
                        <View style={[styles.calendarBendBottom, { backgroundColor: `${type.color}88` }]} />
                      </View>
                    ) : <View style={[styles.calendarInstantRule, { backgroundColor: `${type.color}66` }]} />}
                    <View style={[styles.calendarInstantTag, elderMode && styles.calendarInstantTagElder, instantOverlapsRange && styles.calendarInstantTagBent, elderMode && instantOverlapsRange && styles.calendarInstantTagBentElder, { backgroundColor: type.soft, borderColor: `${type.color}36` }]}>
                      <View style={[styles.calendarInstantIcon, elderMode && styles.calendarInstantIconElder, { backgroundColor: C.paper }]}><Icon name={type.icon} size={elderMode ? 20 : 14} color={type.color} /></View>
                      <View style={styles.calendarInstantCopy}>
                        <Text numberOfLines={1} style={[styles.calendarInstantTitle, { color: type.color }]}>{item.title}</Text>
                        {elderMode && <Text style={[styles.calendarInstantTime, styles.calendarInstantTimeElder, { color: type.color }]}>{item.time}</Text>}
                      </View>
                      {!elderMode && <Text style={[styles.calendarInstantTime, { color: type.color }]}>{item.time}</Text>}
                    </View>
                  </Pressable>
                );
              }
              return (
                <Pressable
                  key={item.id}
                  onPress={() => onEdit(item)}
                  style={({ pressed }) => [
                    styles.calendarEvent,
                    elderMode && styles.calendarEventElder,
                    { top: `${top}%`, height: `${Math.min(height, 100 - top)}%`, backgroundColor: type.soft, borderLeftColor: type.color },
                    pressed && styles.calendarEventPressed,
                  ]}
                >
                  <View style={[styles.calendarEventTop, elderMode && styles.calendarEventTopElder]}>
                    <Icon name={type.icon} size={elderMode ? 20 : 14} color={type.color} />
                    {elderMode ? (
                      <View style={styles.calendarEventCopyElder}>
                        <Text numberOfLines={1} style={[styles.calendarEventTitle, { color: type.color }]}>{item.title}</Text>
                        <Text style={[styles.calendarEventTime, styles.calendarEventTimeElder, { color: type.color }]}>{item.ongoing ? '进行中' : `${item.time}${item.endTime ? `–${item.endTime}` : ''}`}</Text>
                      </View>
                    ) : (
                      <>
                        <Text numberOfLines={1} style={[styles.calendarEventTitle, { color: type.color }]}>{item.title}</Text>
                        {item.ongoing && <View style={[styles.calendarLiveDot, { backgroundColor: type.color }]} />}
                        <Text style={[styles.calendarEventTime, { color: type.color }]}>{item.ongoing ? '进行中' : `${item.time}${item.endTime ? `–${item.endTime}` : ''}`}</Text>
                      </>
                    )}
                    {elderMode && item.ongoing && <View style={[styles.calendarLiveDot, styles.calendarLiveDotElder, { backgroundColor: type.color }]} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Timeline({ items, onEdit, onStopRecord }: { items: TimelineItem[]; onEdit: (item: TimelineItem) => void; onStopRecord: (id: string) => void }) {
  return (
    <View style={styles.timeline}>
      {items.map((item, index) => {
        const type = typeFor(item.kind);
        return (
          <View key={item.id} style={styles.timelineRow}>
            <View style={styles.timeColumn}>
              <Text style={styles.timeText}>{item.time}</Text>
              {item.endTime && <Text style={styles.endTimeText}>{item.endTime}</Text>}
            </View>
            <View style={styles.railColumn}>
              <View style={[styles.timelineDot, { backgroundColor: type.color }]}>
                <Icon name={type.icon} size={13} color="#FFFFFF" />
              </View>
              {index < items.length - 1 && <View style={styles.timelineLine} />}
            </View>
            <Pressable
              onPress={() => onEdit(item)}
              style={({ pressed }) => [styles.eventCard, item.ongoing && styles.eventCardOngoing, pressed && styles.cardPressed]}
            >
              <View style={styles.eventHeader}>
                <View style={[styles.eventIcon, { backgroundColor: type.soft }]}>
                  <Icon name={type.icon} size={20} color={type.color} />
                </View>
                <View style={styles.eventCopy}>
                  <Text style={styles.eventTitle}>{item.title}</Text>
                  <Text style={[styles.eventDetail, item.ongoing && { color: type.color }]}>{item.detail}</Text>
                </View>
                {item.ongoing ? <View style={[styles.liveDot, { backgroundColor: type.color }]} /> : <Icon name="chevron-right" size={19} color="#B7BDC5" />}
              </View>
              {item.note && <Text style={styles.eventNote}>{item.note}</Text>}
              {item.ongoing && (
                <TouchableOpacity style={[styles.stopButton, { backgroundColor: type.color }]} onPress={() => onStopRecord(item.id)}>
                  <Icon name="stop" size={16} color="#FFFFFF" />
                  <Text style={styles.stopButtonText}>结束记录</Text>
                </TouchableOpacity>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function EmptyDay({ day, onAdd }: { day: string; onAdd: () => void }) {
  return (
    <View style={styles.emptyDay}>
      <View style={styles.emptyIllustration}>
        <Icon name="calendar-blank-outline" size={34} color={C.lavender} />
      </View>
      <Text style={styles.emptyTitle}>{day}还没有记录</Text>
      <Text style={styles.emptyText}>从一瓶奶、一次小睡，或任何值得记下的瞬间开始。</Text>
      <TouchableOpacity style={styles.primaryButton} onPress={onAdd}>
        <Icon name="plus" size={19} color="#FFFFFF" />
        <Text style={styles.primaryButtonText}>添加第一条记录</Text>
      </TouchableOpacity>
    </View>
  );
}

function QuickAddBar({ shortcuts, onAdd, onQuickAdd }: { shortcuts: QuickShortcutOption[]; onAdd: () => void; onQuickAdd: (intent: AddIntent) => void }) {
  const elderMode = useElderMode();
  return (
    <View style={[styles.quickAddWrap, elderMode && styles.quickAddWrapElder]}>
      <View style={[styles.quickAddBar, elderMode && styles.quickAddBarElder]}>
        {shortcuts.map((item, index) => (
          <TouchableOpacity key={`${item.id}-${index}`} style={styles.shortcut} onPress={() => onQuickAdd({ kind: item.kind, customName: item.customName, timeMode: item.timeMode })} activeOpacity={0.75}>
            <Icon name={item.icon} size={20} color={item.color} />
            <Text style={styles.shortcutText}>{item.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.fab} onPress={onAdd} activeOpacity={0.82}>
          <Icon name="plus" size={28} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const MONTH_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function calendarMonthCells(month: Date): Array<number | null> {
  const firstWeekday = (new Date(month.getFullYear(), month.getMonth(), 1, 12).getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12).getDate();
  return [...Array.from({ length: firstWeekday }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)];
}

function CalendarScreen({ selectedDateKey, onSelectDate, items, onOpenDay, babyProfile }: { selectedDateKey: string; onSelectDate: (dateKey: string) => void; items: TimelineItem[]; onOpenDay: () => void; babyProfile: BabyProfile }) {
  const selectedDate = dateFromKey(selectedDateKey);
  const [month, setMonth] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12));
  const cells = useMemo(() => calendarMonthCells(month), [month]);
  const selectedItems = useMemo(() => items.filter((item) => item.dateKey === selectedDateKey), [items, selectedDateKey]);
  const kindsByDate = useMemo(() => {
    const result = new Map<string, RecordKind[]>();
    items.forEach((item) => {
      const current = result.get(item.dateKey) ?? [];
      if (!current.includes(item.kind)) result.set(item.dateKey, [...current, item.kind]);
    });
    return result;
  }, [items]);
  const sleepCount = selectedItems.filter((item) => item.kind === 'sleep').length;
  const feedCount = selectedItems.filter((item) => item.kind === 'feed').length;
  const diaperCount = selectedItems.filter((item) => item.kind === 'diaper').length;

  useEffect(() => {
    setMonth((current) => current.getFullYear() === selectedDate.getFullYear() && current.getMonth() === selectedDate.getMonth()
      ? current
      : new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12));
  }, [selectedDateKey]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.calendarPageContent} showsVerticalScrollIndicator={false}>
      <Header babyProfile={babyProfile} />
      <View style={styles.calendarPageHeading}>
        <View>
          <Text style={styles.pageTitle}>日历</Text>
          <Text style={styles.pageSubtitle}>回顾每天的节奏与记录</Text>
        </View>
        <View style={styles.monthNavigator}>
          <TouchableOpacity style={styles.monthNavButton} onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))}><Icon name="chevron-left" size={19} color={C.muted} /></TouchableOpacity>
          <Text style={styles.monthNavigatorText}>{month.getFullYear()}年{month.getMonth() + 1}月</Text>
          <TouchableOpacity style={styles.monthNavButton} onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))}><Icon name="chevron-right" size={19} color={C.muted} /></TouchableOpacity>
        </View>
      </View>
      <View style={styles.monthCard}>
        <View style={styles.monthWeekRow}>
          {MONTH_WEEKDAYS.map((day) => <Text key={day} style={styles.monthWeekText}>{day}</Text>)}
        </View>
        <View style={styles.monthGrid}>
          {cells.map((day, index) => {
            const cellDateKey = day ? localDateKey(new Date(month.getFullYear(), month.getMonth(), day, 12)) : '';
            const active = cellDateKey === selectedDateKey;
            const kinds = day ? kindsByDate.get(cellDateKey) ?? [] : [];
            const isToday = cellDateKey === localDateKey();
            return (
              <TouchableOpacity
                key={`${day ?? 'blank'}-${index}`}
                disabled={!day}
                style={styles.monthDayCell}
                activeOpacity={0.7}
                onPress={() => {
                  if (!day) return;
                  onSelectDate(cellDateKey);
                  onOpenDay();
                }}
              >
                {day ? (
                  <>
                    <View style={[styles.monthDayNumberWrap, active && styles.monthDayNumberActive]}>
                      <Text style={[styles.monthDayNumber, active && styles.monthDayNumberTextActive]}>{day}</Text>
                    </View>
                    <View style={styles.monthDots}>
                      {kinds.slice(0, 3).map((kind, dotIndex) => <View key={`${kind}-${dotIndex}`} style={[styles.monthDot, { backgroundColor: typeFor(kind).color }]} />)}
                    </View>
                    {isToday && !active && <Text style={styles.todayMiniLabel}>今天</Text>}
                  </>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.calendarLegend}>
          {RECORD_TYPES.slice(0, 4).map((item) => <View key={item.key} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: item.color }]} /><Text style={styles.legendText}>{item.label}</Text></View>)}
        </View>
      </View>

      <View style={styles.selectedDayHeading}>
        <View>
          <Text style={styles.selectedDayTitle}>{dateTitle(selectedDateKey)} · 星期{chineseWeekday(selectedDateKey)}</Text>
          <Text style={styles.selectedDaySubtitle}>{selectedItems.length ? `共 ${selectedItems.length} 条记录` : '这一天还没有记录'}</Text>
        </View>
        {selectedDateKey === localDateKey() && <View style={styles.todayBadge}><Text style={styles.todayBadgeText}>今天</Text></View>}
      </View>

      {selectedItems.length ? (
        <View style={styles.calendarSummaryCard}>
          <View style={styles.calendarMetricsRow}>
            <CalendarMetric icon="weather-night" color={C.lavender} soft={C.lavenderSoft} value={`${sleepCount} 段`} label="睡眠" />
            <CalendarMetric icon="baby-bottle-outline" color={C.blue} soft={C.blueSoft} value={`${feedCount} 次`} label="喂养" />
            <CalendarMetric icon="baby-face-outline" color={C.amber} soft={C.amberSoft} value={`${diaperCount} 次`} label="尿布" />
          </View>
        </View>
      ) : (
        <View style={styles.calendarEmptyCard}>
          <View style={styles.calendarEmptyIcon}><Icon name="calendar-blank-outline" size={25} color={C.muted} /></View>
          <Text style={styles.calendarEmptyTitle}>暂无记录</Text>
          <Text style={styles.calendarEmptyText}>可以打开当天时间表补充记录。</Text>
        </View>
      )}

      <View style={{ height: 95 }} />
    </ScrollView>
  );
}

function CalendarMetric({ icon, color, soft, value, label }: { icon: IconName; color: string; soft: string; value: string; label: string }) {
  return (
    <View style={styles.calendarMetric}>
      <View style={[styles.calendarMetricIcon, { backgroundColor: soft }]}><Icon name={icon} size={18} color={color} /></View>
      <Text style={styles.calendarMetricValue}>{value}</Text>
      <Text style={styles.calendarMetricLabel}>{label}</Text>
    </View>
  );
}

function StatsScreen({ items, babyProfile }: { items: TimelineItem[]; babyProfile: BabyProfile }) {
  const [metric, setMetric] = useState<'sleep' | 'feed'>('sleep');
  const dayKeys = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return localDateKey(date);
  }), []);
  const recentItems = useMemo(() => items.filter((item) => dayKeys.includes(item.dateKey)), [items, dayKeys]);
  const sleep = dayKeys.map((dateKey) => recentItems
    .filter((item) => item.dateKey === dateKey && item.kind === 'sleep')
    .reduce((total, item) => total + durationBetween(item.time, item.endTime ?? (item.ongoing && dateKey === localDateKey() ? nowTime() : item.time)) / 60, 0));
  const feed = dayKeys.map((dateKey) => recentItems
    .filter((item) => item.dateKey === dateKey && item.kind === 'feed')
    .reduce((total, item) => total + Number(item.detail.match(/(\d+)\s*ml/i)?.[1] ?? 0), 0));
  const values = metric === 'sleep' ? sleep : feed;
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = total / 7;
  const hasData = values.some((value) => value > 0);
  const sleepCount = recentItems.filter((item) => item.kind === 'sleep').length;
  const feedCount = recentItems.filter((item) => item.kind === 'feed').length;
  const supplementCount = recentItems.filter((item) => item.kind === 'supplement').length;
  const averageLabel = metric === 'sleep'
    ? `${Math.floor(average)} 小时 ${Math.round((average % 1) * 60)} 分`
    : `${Math.round(average)} ml`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
      <PageHeader title="成长趋势" subtitle={`${babyProfile.name || '宝宝'}最近 7 天的真实记录`} icon="calendar-month-outline" />
      <View style={styles.segmented}>
        <Segment label="睡眠" active={metric === 'sleep'} onPress={() => setMetric('sleep')} />
        <Segment label="喂养" active={metric === 'feed'} onPress={() => setMetric('feed')} />
      </View>
      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.chartLabel}>过去 7 天平均</Text>
            <Text style={styles.chartValue}>{averageLabel}</Text>
          </View>
        </View>
        {hasData ? (
          <View style={styles.chart}>
            {values.map((value, index) => (
              <View key={dayKeys[index]} style={styles.barColumn}>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { height: `${(value / max) * 100}%`, backgroundColor: metric === 'sleep' ? C.lavender : C.blue }]} />
                </View>
                <Text style={styles.barLabel}>{chineseWeekday(dayKeys[index] ?? localDateKey())}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.statsEmpty}>
            <Icon name="chart-box-outline" size={30} color={C.muted} />
            <Text style={styles.statsEmptyTitle}>最近 7 天暂无{metric === 'sleep' ? '睡眠' : '奶量'}数据</Text>
            <Text style={styles.statsEmptyText}>添加记录后，这里会自动生成真实趋势。</Text>
          </View>
        )}
      </View>
      <Text style={styles.listHeading}>本周记录</Text>
      <InsightCard icon="weather-night" color={C.lavender} soft={C.lavenderSoft} title={`${sleepCount} 段睡眠`} text="仅统计最近 7 天已保存的睡眠记录。" />
      <InsightCard icon="baby-bottle-outline" color={C.blue} soft={C.blueSoft} title={`${feedCount} 次喂养`} text="奶量趋势仅统计填写了毫升数的记录。" />
      <InsightCard icon="pill" color={C.sage} soft={C.sageSoft} title={`${supplementCount} 次营养补充`} text="数据来自铁剂、维生素 D 和维生素 AD 记录。" />
      <View style={{ height: 112 }} />
    </ScrollView>
  );
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.segment, active && styles.segmentActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function InsightCard({ icon, color, soft, title, text }: { icon: IconName; color: string; soft: string; title: string; text: string }) {
  return (
    <View style={styles.insightCard}>
      <View style={[styles.insightIcon, { backgroundColor: soft }]}><Icon name={icon} size={23} color={color} /></View>
      <View style={styles.insightCopy}>
        <Text style={styles.insightTitle}>{title}</Text>
        <Text style={styles.insightText}>{text}</Text>
      </View>
    </View>
  );
}

function SettingsScreen({
  customProjects,
  onAdd,
  elderMode,
  onChangeElderMode,
  babyProfile,
  onEditBabyProfile,
  currentRole,
  roles,
  onManageRoles,
  backupCount,
  onOpenBackups,
  onSwitchRole,
  quickShortcutIds,
  onToggleQuickShortcut,
  syncEndpoint,
  syncPasswordConfigured,
  onEditSyncEndpoint,
  onDownloadAndroid,
  onExport,
}: {
  customProjects: CustomProject[];
  onAdd: () => void;
  elderMode: boolean;
  onChangeElderMode: (enabled: boolean) => void;
  babyProfile: BabyProfile;
  onEditBabyProfile: () => void;
  currentRole: SavedRole;
  roles: SavedRole[];
  onManageRoles: () => void;
  backupCount: number;
  onOpenBackups: () => void;
  onSwitchRole: () => void;
  quickShortcutIds: string[];
  onToggleQuickShortcut: (id: string) => void;
  syncEndpoint: string;
  syncPasswordConfigured: boolean;
  onEditSyncEndpoint: () => void;
  onDownloadAndroid: () => void;
  onExport: () => void;
}) {
  const availableShortcuts = shortcutOptions(customProjects);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
      <PageHeader title="设置" subtitle="管理记录、家庭与数据" icon="cog-outline" />
      <Text style={styles.settingsSectionTitle}>当前角色</Text>
      <Text style={styles.settingsSectionHint}>本设备会自动进入已保存的角色</Text>
      <View style={styles.settingsList}>
        <SettingsRow
          icon={roleIcon(currentRole)}
          color={currentRole.isAdmin ? C.peach : C.sage}
          soft={currentRole.isAdmin ? C.peachSoft : C.sageSoft}
          title={currentRole.name}
          subtitle={currentRole.isAdmin ? '管理员角色 · 可管理家庭配置' : '家庭成员 · 偏好独立保存'}
          value="切换"
          onPress={onSwitchRole}
        />
        {currentRole.isAdmin && (
          <SettingsRow
            icon="account-cog-outline"
            color={C.blue}
            soft={C.blueSoft}
            title="用户与权限"
            subtitle="修改角色名称或删除用户"
            value={`${roles.length} 个`}
            onPress={onManageRoles}
          />
        )}
      </View>
      <Text style={styles.settingsSectionTitle}>宝宝资料</Text>
      <Text style={styles.settingsSectionHint}>年龄会根据出生日期自动计算</Text>
      <View style={styles.settingsList}>
        <SettingsRow
          icon="baby-face-outline"
          color={C.peach}
          soft={C.peachSoft}
          title={babyProfile.name}
          subtitle={currentRole.isAdmin ? `出生日期 ${formatBirthDate(babyProfile.birthDate)}` : '需要管理员权限才能修改'}
          value={currentRole.isAdmin ? babyAgeFromBirthDate(babyProfile.birthDate) : '已锁定'}
          onPress={currentRole.isAdmin ? onEditBabyProfile : undefined}
        />
      </View>
      <Text style={styles.settingsSectionTitle}>显示与辅助</Text>
      <Text style={styles.settingsSectionHint}>按使用者需要调整全局阅读体验</Text>
      <View style={[styles.accessibilityCard, elderMode && styles.accessibilityCardActive]}>
        <View style={[styles.settingsRowIcon, { backgroundColor: elderMode ? C.peachSoft : C.blueSoft }]}>
          <Icon name="account-eye-outline" size={23} color={elderMode ? C.peach : C.blue} />
        </View>
        <View style={styles.accessibilityCopy}>
          <Text style={styles.accessibilityTitle}>长辈模式</Text>
          <Text style={styles.accessibilityText}>{elderMode ? '大号文字已应用到整个 App' : '放大文字与时间表，提升阅读清晰度'}</Text>
          <View style={styles.fontPreviewRow}>
            <Text style={styles.fontPreviewSmall}>标准</Text>
            <Icon name="arrow-right" size={14} color={C.muted} />
            <Text style={styles.fontPreviewLarge}>长辈</Text>
          </View>
        </View>
        <Switch
          value={elderMode}
          onValueChange={onChangeElderMode}
          trackColor={{ false: '#D7DADD', true: '#F2B89F' }}
          thumbColor={elderMode ? C.peach : '#FFFFFF'}
          accessibilityLabel="长辈模式"
          accessibilityHint="开启后放大整个应用的文字和主要操作区域"
        />
      </View>
      <View style={styles.accessibilityNote}>
        <Icon name="information-outline" size={16} color={C.sage} />
        <Text style={styles.accessibilityNoteText}>参考系统动态字体层级：正文约 18pt，辅助文字约 16pt，并继续跟随手机系统字号。</Text>
      </View>
      <Text style={styles.settingsSectionTitle}>记录项目</Text>
      <Text style={styles.settingsSectionHint}>每个用户可以设置不同的主页快捷项</Text>
      <View style={styles.shortcutSettingsCard}>
        <View style={styles.shortcutSettingsHeading}>
          <View>
            <Text style={styles.shortcutSettingsTitle}>{currentRole.name}的主页快捷项</Text>
            <Text style={styles.shortcutSettingsHint}>选择最多 4 项 · 点击即可切换</Text>
          </View>
          <Text style={styles.shortcutSettingsCount}>{quickShortcutIds.length}/4</Text>
        </View>
        <View style={styles.shortcutChoiceWrap}>
          {availableShortcuts.map((item) => {
            const active = quickShortcutIds.includes(item.id);
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.shortcutChoice, active && { backgroundColor: item.soft, borderColor: item.color }]}
                activeOpacity={0.72}
                onPress={() => onToggleQuickShortcut(item.id)}
              >
                <Icon name={item.icon} size={18} color={active ? item.color : C.muted} />
                <Text style={[styles.shortcutChoiceText, active && { color: item.color }]}>{item.label}</Text>
                <Icon name={active ? 'check-circle' : 'plus-circle-outline'} size={17} color={active ? item.color : '#A8AFB7'} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      <Text style={styles.listHeading}>常用项目</Text>
      <View style={styles.projectList}>
        {RECORD_TYPES.slice(0, 5).map((item) => (
          <ProjectRow key={item.key} icon={item.icon} color={item.color} soft={item.soft} name={item.label} description={projectDescription(item.key)} fixed />
        ))}
      </View>
      <View style={styles.customHeadingRow}>
        <Text style={styles.listHeading}>我的自定义</Text>
        <Text style={styles.itemCount}>{customProjects.length} 项</Text>
      </View>
      <View style={styles.projectList}>
        {customProjects.map((item) => (
          <ProjectRow key={item.id} icon={item.icon} color={item.color} soft={item.soft} name={item.name} description={`${item.timeMode === 'range' ? '时间段' : '时刻'}记录 · 可在时间表中快速添加`} />
        ))}
      </View>
      <TouchableOpacity style={styles.addProjectButton} onPress={onAdd}>
        <View style={styles.addProjectIcon}><Icon name="plus" size={22} color={C.pink} /></View>
        <View style={styles.insightCopy}>
          <Text style={styles.addProjectTitle}>添加自定义项目</Text>
          <Text style={styles.addProjectText}>例如辅食、洗澡、体温、药物</Text>
        </View>
        <Icon name="chevron-right" size={20} color={C.muted} />
      </TouchableOpacity>
      <Text style={styles.settingsSectionTitle}>{Platform.OS === 'web' ? '数据管理' : '数据与同步'}</Text>
      <Text style={styles.settingsSectionHint}>{Platform.OS === 'web' ? '网页端使用当前站点的同源服务，无需配置同步地址' : '设置 Android 同步接口，或随时导出自己的数据'}</Text>
      <View style={styles.settingsList}>
        {Platform.OS !== 'web' && <SettingsRow icon="api" color={C.sage} soft={C.sageSoft} title="同步接口设置" subtitle={`${syncEndpoint || '未设置地址'} · 密码${syncPasswordConfigured ? '已设置' : '未设置'}`} value="HTTPS" onPress={onEditSyncEndpoint} />}
        {Platform.OS === 'android' && <SettingsRow icon="cellphone-arrow-down" color={C.lavender} soft={C.lavenderSoft} title="Android 安装包" subtitle={`当前版本 v${APP_VERSION} · ${ANDROID_APK_NAME}`} value="下载" onPress={onDownloadAndroid} />}
        {currentRole.isAdmin && <SettingsRow icon="backup-restore" color={C.blue} soft={C.blueSoft} title="备份与恢复" subtitle="每天自动备份 · 保留最近 30 天" value={`${backupCount} 份`} onPress={onOpenBackups} />}
        <SettingsRow icon="file-export-outline" color={C.peach} soft={C.peachSoft} title="导出数据" subtitle="JSON / CSV / 儿保摘要" onPress={onExport} />
      </View>
      <View style={styles.familyCard}>
        <View style={styles.familyAvatars}>
          <View style={[styles.familyAvatar, { backgroundColor: C.peachSoft }]}><Text>妈</Text></View>
          <View style={[styles.familyAvatar, { backgroundColor: C.blueSoft, marginLeft: -8 }]}><Text>爸</Text></View>
          <View style={[styles.familyAvatar, { backgroundColor: C.sageSoft, marginLeft: -8 }]}><Icon name="plus" size={15} color={C.sage} /></View>
        </View>
        <Text style={styles.familyTitle}>一起记录，不错过每个时刻</Text>
        <Text style={styles.familyText}>正式版将支持邀请家人并实时同步。</Text>
      </View>
      <View style={{ height: 112 }} />
    </ScrollView>
  );
}

function SettingsRow({ icon, color, soft, title, subtitle, value, onPress }: { icon: IconName; color: string; soft: string; title: string; subtitle: string; value?: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.settingsRow} activeOpacity={0.72} onPress={onPress} disabled={!onPress}>
      <View style={[styles.settingsRowIcon, { backgroundColor: soft }]}><Icon name={icon} size={21} color={color} /></View>
      <View style={styles.settingsRowCopy}>
        <Text style={styles.settingsRowTitle}>{title}</Text>
        <Text style={styles.settingsRowSubtitle}>{subtitle}</Text>
      </View>
      {value && <Text style={styles.settingsRowValue}>{value}</Text>}
      <Icon name={onPress ? 'chevron-right' : 'lock-outline'} size={19} color="#A8AFB7" />
    </TouchableOpacity>
  );
}

function projectDescription(kind: RecordKind) {
  const map: Partial<Record<RecordKind, string>> = {
    sleep: '开始、结束与睡眠时长', feed: '母乳、奶瓶与毫升数', activity: '活动类型与持续时间', diaper: '大小便类型与状态', supplement: '铁剂、维生素 D、维生素 AD',
  };
  return map[kind] ?? '';
}

function ProjectRow({ icon, color, soft, name, description, fixed }: { icon: IconName; color: string; soft: string; name: string; description: string; fixed?: boolean }) {
  return (
    <TouchableOpacity style={styles.projectRow} activeOpacity={0.76}>
      <View style={[styles.projectIcon, { backgroundColor: soft }]}><Icon name={icon} size={22} color={color} /></View>
      <View style={styles.projectCopy}>
        <Text style={styles.projectName}>{name}</Text>
        <Text style={styles.projectDescription}>{description}</Text>
      </View>
      {fixed ? <Text style={styles.fixedTag}>系统</Text> : <Icon name="drag-horizontal-variant" size={22} color="#BCC1C7" />}
    </TouchableOpacity>
  );
}

function PageHeader({ title, subtitle, icon }: { title: string; subtitle: string; icon: IconName }) {
  return (
    <View style={styles.pageHeader}>
      <View>
        <Text style={styles.pageTitle}>{title}</Text>
        <Text style={styles.pageSubtitle}>{subtitle}</Text>
      </View>
      <TouchableOpacity style={styles.roundButton}><Icon name={icon} size={22} color={C.ink} /></TouchableOpacity>
    </View>
  );
}

function BottomTabs({ active, onChange }: { active: TabKey; onChange: (key: TabKey) => void }) {
  const elderMode = useElderMode();
  const tabs: { key: TabKey; label: string; icon: IconName; activeIcon: IconName }[] = [
    { key: 'today', label: '今天', icon: 'calendar-blank-outline', activeIcon: 'calendar' },
    { key: 'calendar', label: '日历', icon: 'calendar-month-outline', activeIcon: 'calendar-month' },
    { key: 'stats', label: '趋势', icon: 'chart-bar', activeIcon: 'chart-box' },
    { key: 'settings', label: '设置', icon: 'cog-outline', activeIcon: 'cog' },
  ];
  return (
    <View style={[styles.bottomTabs, elderMode && styles.bottomTabsElder]}>
      {tabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <TouchableOpacity key={tab.key} style={styles.tabItem} onPress={() => onChange(tab.key)} activeOpacity={0.75}>
            <View style={[styles.tabIcon, selected && styles.tabIconActive]}>
              <Icon name={selected ? tab.activeIcon : tab.icon} size={elderMode ? 24 : 21} color={selected ? C.navy : '#929AA5'} />
            </View>
            <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function AddRecordSheet({ visible, preset, initialKind, initialCustomName, initialTimeMode, customProjects, existingItems, targetDateKey, onClose, onSave }: { visible: boolean; preset?: TodoItem | null; initialKind?: RecordKind; initialCustomName?: string; initialTimeMode?: TimeMode; customProjects: CustomProject[]; existingItems: TimelineItem[]; targetDateKey: string; onClose: () => void; onSave: (item: TimelineItem) => void }) {
  const startingKind = preset?.kind ?? initialKind ?? null;
  const startingChoice = preset?.kind === 'supplement'
    ? preset.title.includes('铁') ? '铁剂' : preset.title.includes('AD') ? '维生素 AD' : '维生素 D'
    : startingKind === 'activity' ? '趴卧练习'
    : startingKind === 'diaper' ? '小便'
    : startingKind === 'supplement' ? '维生素 D'
    : '配方奶';
  const [selected, setSelected] = useState<RecordKind | null>(startingKind);
  const [customName, setCustomName] = useState(initialCustomName ?? '');
  const [amount, setAmount] = useState('160');
  const [note, setNote] = useState('');
  const [time, setTime] = useState(preset?.time ?? nowTime());
  const [endTime, setEndTime] = useState(nowTime());
  const [rangeHasEnd, setRangeHasEnd] = useState(false);
  const [customTimeMode, setCustomTimeMode] = useState<TimeMode>(initialTimeMode ?? 'instant');
  const [choice, setChoice] = useState(startingChoice);

  useEffect(() => {
    if (!visible) return;
    const nextKind = preset?.kind ?? initialKind ?? null;
    setSelected(nextKind);
    setCustomName(initialCustomName ?? '');
    setCustomTimeMode(initialTimeMode ?? 'instant');
    setTime(preset?.time ?? nowTime());
    setEndTime(nowTime());
    setRangeHasEnd(false);
    setNote('');
    if (nextKind === 'feed') setChoice('配方奶');
    if (nextKind === 'activity') setChoice('趴卧练习');
    if (nextKind === 'diaper') setChoice('小便');
    if (preset?.kind === 'supplement') {
      if (preset.title.includes('铁')) setChoice('铁剂');
      else if (preset.title.includes('AD')) setChoice('维生素 AD');
      else setChoice('维生素 D');
    } else if (nextKind === 'supplement') {
      setChoice('维生素 D');
    }
  }, [visible, preset, initialKind, initialCustomName, initialTimeMode]);

  const close = () => {
    Keyboard.dismiss();
    setSelected(null);
    setNote('');
    setRangeHasEnd(false);
    onClose();
  };

  const save = () => {
    if (!selected) return;
    const recordTimeMode = timeModeFor(selected, customTimeMode);
    const isRange = recordTimeMode === 'range';
    const isOngoing = isRange && !rangeHasEnd;
    const rangeDetail = rangeHasEnd ? sleepDurationText(time, endTime) : '进行中 · 正在计时';
    const definitions: Record<RecordKind, { title: string; detail: string }> = {
      sleep: { title: '睡眠', detail: rangeHasEnd ? sleepDurationText(time, endTime) : '睡眠中 · 正在计时' },
      feed: { title: choice, detail: choice === '母乳亲喂' ? '已记录' : `${amount || 0} ml` },
      activity: { title: choice || '亲子活动', detail: rangeDetail },
      diaper: { title: '换尿布', detail: choice },
      supplement: { title: choice, detail: '1 次 · 已完成' },
      custom: { title: customName || choice || '自定义记录', detail: isRange ? rangeDetail : '已记录' },
    };
    const definition = definitions[selected];
    const candidate: TimelineItem = {
      id: String(Date.now()),
      dateKey: targetDateKey,
      kind: selected,
      timeMode: recordTimeMode,
      time,
      endTime: isRange && rangeHasEnd ? endTime : undefined,
      title: definition.title,
      detail: definition.detail,
      note: note || undefined,
      ongoing: isOngoing,
    };
    const commit = () => {
      Keyboard.dismiss();
      onSave(candidate);
      setSelected(null);
      setNote('');
      setRangeHasEnd(false);
    };
    const conflict = findRangeConflict(candidate, existingItems);
    if (conflict) {
      Alert.alert(
        '时间段有重叠',
        `与“${conflict.title}”的 ${conflict.time}${conflict.endTime ? `–${conflict.endTime}` : '–进行中'} 重叠，请确认是否仍要保存。`,
        [{ text: '返回调整', style: 'cancel' }, { text: '仍然保存', onPress: commit }],
      );
      return;
    }
    commit();
  };

  const setKind = (kind: RecordKind, label?: string, projectTimeMode?: TimeMode) => {
    setSelected(kind);
    const nextTimeMode = timeModeFor(kind, projectTimeMode ?? 'instant');
    if (kind === 'custom') setCustomTimeMode(projectTimeMode ?? 'instant');
    if (nextTimeMode === 'range') {
      setTime(nowTime());
      setEndTime(nowTime());
      setRangeHasEnd(false);
    }
    if (label) setCustomName(label);
    if (kind === 'feed') setChoice('配方奶');
    if (kind === 'activity') setChoice('趴卧练习');
    if (kind === 'diaper') setChoice('小便');
    if (kind === 'supplement') setChoice('维生素 D');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent hardwareAccelerated onRequestClose={close}>
      <StableKeyboardRoot style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            {selected ? (
              <TouchableOpacity style={styles.sheetHeaderButton} onPress={preset || initialKind ? close : () => setSelected(null)}><Icon name="arrow-left" size={21} color={C.ink} /></TouchableOpacity>
            ) : <View style={styles.sheetHeaderButton} />}
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle}>{preset ? `完成：${preset.title}` : selected ? `记录${initialCustomName || typeFor(selected).label}` : '添加记录'}</Text>
              <Text style={styles.sheetSubtitle}>{preset ? `建议时间 ${preset.time} · 可以修改` : selected ? `${targetDateKey === localDateKey() ? '今天' : dateTitle(targetDateKey)} · 星期${chineseWeekday(targetDateKey)}` : '刚刚发生了什么？'}</Text>
            </View>
            <TouchableOpacity style={styles.sheetHeaderButton} onPress={close}><Icon name="close" size={21} color={C.ink} /></TouchableOpacity>
          </View>
          {!selected ? (
            <ScrollView contentContainerStyle={styles.kindGridWrap} showsVerticalScrollIndicator={false}>
              <View style={styles.kindGrid}>
                {RECORD_TYPES.slice(0, 5).map((item) => (
                  <TouchableOpacity key={item.key} style={styles.kindTile} onPress={() => setKind(item.key)} activeOpacity={0.75}>
                    <View style={[styles.kindIcon, { backgroundColor: item.soft }]}><Icon name={item.icon} size={27} color={item.color} /></View>
                    <Text style={styles.kindLabel}>{item.label}</Text>
                    <Text style={styles.kindHint}>{kindHint(item.key)}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.kindTile} onPress={() => setKind('custom')} activeOpacity={0.75}>
                  <View style={[styles.kindIcon, { backgroundColor: C.pinkSoft }]}><Icon name="plus" size={27} color={C.pink} /></View>
                  <Text style={styles.kindLabel}>自定义</Text>
                  <Text style={styles.kindHint}>记录其他事情</Text>
                </TouchableOpacity>
              </View>
              {customProjects.length > 0 && (
                <>
                  <Text style={styles.sheetSectionLabel}>我的快捷项目</Text>
                  <View style={styles.customChips}>
                    {customProjects.map((item) => (
                      <TouchableOpacity key={item.id} style={[styles.customChip, { backgroundColor: item.soft }]} onPress={() => setKind('custom', item.name, item.timeMode)}>
                        <Icon name={item.icon} size={18} color={item.color} />
                        <Text style={[styles.customChipText, { color: item.color }]}>{item.name}</Text>
                        <Text style={[styles.customChipMode, { color: item.color }]}>{item.timeMode === 'range' ? '时间段' : '时刻'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
          ) : (
            <RecordForm
              kind={selected}
              time={time}
              setTime={setTime}
              endTime={endTime}
              setEndTime={setEndTime}
              rangeHasEnd={rangeHasEnd}
              setRangeHasEnd={setRangeHasEnd}
              customTimeMode={customTimeMode}
              setCustomTimeMode={setCustomTimeMode}
              conflict={selected && timeModeFor(selected, customTimeMode) === 'range' ? findRangeConflict({ id: 'draft', dateKey: targetDateKey, kind: selected, timeMode: 'range', time, endTime: rangeHasEnd ? endTime : nowTime(), title: '', detail: '' }, existingItems) : undefined}
              amount={amount}
              setAmount={setAmount}
              note={note}
              setNote={setNote}
              choice={choice}
              setChoice={setChoice}
              customName={customName}
              setCustomName={setCustomName}
              onSave={save}
            />
          )}
        </View>
      </StableKeyboardRoot>
    </Modal>
  );
}

function kindHint(kind: RecordKind) {
  const hints: Record<RecordKind, string> = { sleep: '时间段 · 可计时', feed: '时刻 · 奶量与方式', activity: '时间段 · 可计时', diaper: '时刻 · 大便和小便', supplement: '时刻 · 铁剂与维生素', custom: '自选时刻或时间段' };
  return hints[kind];
}

function RecordForm({ kind, time, setTime, endTime, setEndTime, rangeHasEnd, setRangeHasEnd, customTimeMode, setCustomTimeMode, conflict, amount, setAmount, note, setNote, choice, setChoice, customName, setCustomName, onSave }: {
  kind: RecordKind;
  time: string;
  setTime: (value: string) => void;
  endTime: string;
  setEndTime: (value: string) => void;
  rangeHasEnd: boolean;
  setRangeHasEnd: (value: boolean) => void;
  customTimeMode: TimeMode;
  setCustomTimeMode: (value: TimeMode) => void;
  conflict?: TimelineItem;
  amount: string;
  setAmount: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  choice: string;
  setChoice: (value: string) => void;
  customName: string;
  setCustomName: (value: string) => void;
  onSave: () => void;
}) {
  const choices = useMemo(() => {
    if (kind === 'feed') return ['配方奶', '母乳亲喂', '母乳瓶喂'];
    if (kind === 'activity') return ['趴卧练习', '亲子阅读', '户外散步'];
    if (kind === 'diaper') return ['小便', '大便', '大小便'];
    if (kind === 'supplement') return ['铁剂', '维生素 D', '维生素 AD'];
    return [];
  }, [kind]);
  const type = typeFor(kind);
  const recordTimeMode = timeModeFor(kind, customTimeMode);
  const isRange = recordTimeMode === 'range';

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={[styles.formHeroIcon, { backgroundColor: type.soft }]}><Icon name={type.icon} size={30} color={type.color} /></View>
      {kind === 'custom' && (
        <Field label="记录时间类型">
          <View style={styles.timeModeCards}>
            <TouchableOpacity style={[styles.timeModeCard, customTimeMode === 'instant' && { backgroundColor: type.soft, borderColor: type.color }]} onPress={() => { setCustomTimeMode('instant'); setRangeHasEnd(false); }}>
              <Icon name="clock-time-eight-outline" size={21} color={customTimeMode === 'instant' ? type.color : C.muted} />
              <View style={styles.sleepStateCopy}><Text style={[styles.sleepStateTitle, customTimeMode === 'instant' && { color: type.color }]}>时刻</Text><Text style={styles.sleepStateHint}>记录某一刻发生的事</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.timeModeCard, customTimeMode === 'range' && { backgroundColor: type.soft, borderColor: type.color }]} onPress={() => setCustomTimeMode('range')}>
              <Icon name="timeline-clock-outline" size={21} color={customTimeMode === 'range' ? type.color : C.muted} />
              <View style={styles.sleepStateCopy}><Text style={[styles.sleepStateTitle, customTimeMode === 'range' && { color: type.color }]}>时间段</Text><Text style={styles.sleepStateHint}>有开始和结束时间</Text></View>
            </TouchableOpacity>
          </View>
        </Field>
      )}
      {isRange && (
        <View style={styles.sleepStateCards}>
          <TouchableOpacity style={[styles.sleepStateCard, !rangeHasEnd && { backgroundColor: type.soft, borderColor: type.color }]} onPress={() => setRangeHasEnd(false)}>
            <Icon name="timer-outline" size={20} color={!rangeHasEnd ? type.color : C.muted} />
            <View style={styles.sleepStateCopy}>
              <Text style={[styles.sleepStateTitle, !rangeHasEnd && { color: type.color }]}>开始计时</Text>
              <Text style={styles.sleepStateHint}>暂不填写结束时间</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sleepStateCard, rangeHasEnd && { backgroundColor: type.soft, borderColor: type.color }]} onPress={() => { setRangeHasEnd(true); if (!endTime) setEndTime(nowTime()); }}>
            <Icon name="timeline-check-outline" size={20} color={rangeHasEnd ? type.color : C.muted} />
            <View style={styles.sleepStateCopy}>
              <Text style={[styles.sleepStateTitle, rangeHasEnd && { color: type.color }]}>已经结束</Text>
              <Text style={styles.sleepStateHint}>选择完整时间段</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}
      {choices.length > 0 && (
        <Field label={kind === 'supplement' ? '补充项目' : kind === 'diaper' ? '情况' : '类型'}>
          <View style={styles.choiceWrap}>
            {choices.map((item) => (
              <TouchableOpacity key={item} style={[styles.choiceChip, choice === item && { backgroundColor: type.soft, borderColor: type.color }]} onPress={() => setChoice(item)}>
                <Text style={[styles.choiceText, choice === item && { color: type.color }]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Field>
      )}
      {kind === 'custom' && (
        <Field label="项目名称">
          <TextInput style={styles.input} value={customName} onChangeText={setCustomName} placeholder="例如：辅食、洗澡、体温" placeholderTextColor="#A6ADB6" />
        </Field>
      )}
      {kind === 'feed' && choice !== '母乳亲喂' && (
        <Field label="奶量">
          <View style={styles.amountRow}>
            <TouchableOpacity style={styles.amountButton} onPress={() => setAmount(String(Math.max(0, Number(amount) - 10)))}><Icon name="minus" size={21} /></TouchableOpacity>
            <View style={styles.amountInputWrap}>
              <TextInput style={styles.amountInput} value={amount} onChangeText={setAmount} keyboardType="number-pad" />
              <Text style={styles.amountUnit}>ml</Text>
            </View>
            <TouchableOpacity style={styles.amountButton} onPress={() => setAmount(String(Number(amount || 0) + 10))}><Icon name="plus" size={21} /></TouchableOpacity>
          </View>
          <View style={styles.presetRow}>
            {[120, 150, 180, 210].map((value) => <TouchableOpacity key={value} style={styles.preset} onPress={() => setAmount(String(value))}><Text style={styles.presetText}>{value}</Text></TouchableOpacity>)}
          </View>
        </Field>
      )}
      <Field label={isRange ? '开始时间' : '记录时间'}>
        <TimePickerField value={time} onChange={setTime} color={type.color} />
      </Field>
      {isRange && rangeHasEnd && (
        <Field label="结束时间">
          <TimePickerField value={endTime} onChange={setEndTime} color={type.color} />
          <View style={styles.durationPreview}>
            <Icon name="clock-check-outline" size={15} color={type.color} />
            <Text style={[styles.durationPreviewText, { color: type.color }]}>持续时间 {sleepDurationText(time, endTime)}</Text>
          </View>
        </Field>
      )}
      {isRange && conflict && (
        <View style={styles.timeConflictNotice}>
          <Icon name="alert-circle-outline" size={19} color={C.danger} />
          <View style={styles.timeConflictCopy}>
            <Text style={styles.timeConflictTitle}>这个时间段与“{conflict.title}”重叠</Text>
            <Text style={styles.timeConflictText}>{conflict.time}{conflict.endTime ? `–${conflict.endTime}` : '–进行中'} · 保存时会再次确认</Text>
          </View>
        </View>
      )}
      {kind === 'diaper' && (
        <Field label="状态（可选）">
          <View style={styles.choiceWrap}>{['少量', '适中', '较多'].map((item) => <TouchableOpacity key={item} style={styles.choiceChip}><Text style={styles.choiceText}>{item}</Text></TouchableOpacity>)}</View>
        </Field>
      )}
      <Field label="备注（可选）">
        <TextInput style={[styles.input, styles.noteInput]} value={note} onChangeText={setNote} placeholder="写下一点细节..." placeholderTextColor="#A6ADB6" multiline />
      </Field>
      <TouchableOpacity style={[styles.saveButton, { backgroundColor: type.color }]} onPress={onSave} activeOpacity={0.82}>
        <Icon name={isRange && !rangeHasEnd ? 'play' : 'check'} size={19} color="#FFFFFF" />
        <Text style={styles.saveButtonText}>{isRange ? rangeHasEnd ? '保存时间段' : '开始计时' : '保存记录'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const WHEEL_ITEM_HEIGHT = 42;
const WHEEL_HOURS = Array.from({ length: 24 }, (_, index) => index);
const WHEEL_MINUTES = Array.from({ length: 60 }, (_, index) => index);

function TimePickerField({ value, onChange, color }: { value: string; onChange: (value: string) => void; color: string }) {
  const [open, setOpen] = useState(false);
  const openPicker = () => {
    Keyboard.dismiss();
    setOpen(true);
  };
  return (
    <>
      <View style={styles.timePickerFieldRow}>
        <TouchableOpacity style={styles.timePickerButton} activeOpacity={0.72} onPress={openPicker}>
          <Icon name="clock-outline" size={19} color={color} />
          <Text style={styles.timePickerValue}>{value}</Text>
          <Text style={styles.timePickerHint}>滑动选择</Text>
          <Icon name="chevron-down" size={18} color={C.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.timeNowButton, { backgroundColor: `${color}18` }]} onPress={() => onChange(nowTime())}>
          <Text style={[styles.timeNowText, { color }]}>现在</Text>
        </TouchableOpacity>
      </View>
      {open && <WheelTimePicker visible value={value} color={color} onClose={() => setOpen(false)} onChange={onChange} />}
    </>
  );
}

function WheelTimePicker({ visible, value, color, onClose, onChange }: { visible: boolean; value: string; color: string; onClose: () => void; onChange: (value: string) => void }) {
  const parsed = value.split(':').map(Number);
  const [hour, setHour] = useState(parsed[0] ?? 0);
  const [minute, setMinute] = useState(parsed[1] ?? 0);
  const hourRef = React.useRef<ScrollView>(null);
  const minuteRef = React.useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    const [nextHour = 0, nextMinute = 0] = value.split(':').map(Number);
    setHour(nextHour);
    setMinute(nextMinute);
    const timer = setTimeout(() => {
      hourRef.current?.scrollTo({ y: nextHour * WHEEL_ITEM_HEIGHT, animated: false });
      minuteRef.current?.scrollTo({ y: nextMinute * WHEEL_ITEM_HEIGHT, animated: false });
    }, 60);
    return () => clearTimeout(timer);
  }, [visible, value]);

  const handleEnd = (kind: 'hour' | 'minute') => (event: any) => {
    const max = kind === 'hour' ? 23 : 59;
    const index = Math.max(0, Math.min(max, Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT)));
    if (kind === 'hour') setHour(index);
    else setMinute(index);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent hardwareAccelerated onRequestClose={onClose}>
      <View style={styles.wheelModalRoot}>
        <Pressable style={styles.wheelBackdrop} onPress={onClose} />
        <View style={styles.wheelSheet}>
          <View style={styles.wheelHeader}>
            <TouchableOpacity onPress={onClose}><Text style={styles.wheelCancel}>取消</Text></TouchableOpacity>
            <View style={styles.wheelHeaderTitleWrap}>
              <Text style={styles.wheelTitle}>选择时间</Text>
              <Text style={styles.wheelSelectedValue}>{String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}</Text>
            </View>
            <TouchableOpacity onPress={() => { onChange(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`); onClose(); }}>
              <Text style={[styles.wheelDone, { color }]}>完成</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.wheelsWrap}>
            <View pointerEvents="none" style={[styles.wheelSelection, { borderColor: `${color}38`, backgroundColor: `${color}12` }]} />
            <WheelColumn refValue={hourRef} values={WHEEL_HOURS} selected={hour} suffix="时" onEnd={handleEnd('hour')} />
            <Text style={styles.wheelColon}>:</Text>
            <WheelColumn refValue={minuteRef} values={WHEEL_MINUTES} selected={minute} suffix="分" onEnd={handleEnd('minute')} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function WheelColumn({ refValue, values, selected, suffix, onEnd }: { refValue: React.RefObject<ScrollView | null>; values: number[]; selected: number; suffix: string; onEnd: (event: any) => void }) {
  return (
    <ScrollView
      ref={refValue}
      style={styles.wheelColumn}
      contentContainerStyle={styles.wheelColumnContent}
      showsVerticalScrollIndicator={false}
      snapToInterval={WHEEL_ITEM_HEIGHT}
      decelerationRate="fast"
      onMomentumScrollEnd={onEnd}
      onScrollEndDrag={onEnd}
    >
      {values.map((item) => (
        <View key={item} style={styles.wheelItem}>
          <Text style={[styles.wheelItemText, item === selected && styles.wheelItemTextSelected]}>{String(item).padStart(2, '0')}</Text>
          <Text style={styles.wheelSuffix}>{suffix}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>;
}

const BIRTH_YEARS = Array.from({ length: 19 }, (_, index) => new Date().getFullYear() - 18 + index);

function DateWheelColumn({ values, selected, suffix, onChange }: { values: number[]; selected: number; suffix: string; onChange: (value: number) => void }) {
  const ref = React.useRef<ScrollView>(null);
  const selectedIndex = Math.max(0, values.indexOf(selected));

  useEffect(() => {
    const timer = setTimeout(() => ref.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_HEIGHT, animated: false }), 60);
    return () => clearTimeout(timer);
  }, [selectedIndex, values.length]);

  const finish = (event: any) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT)));
    onChange(values[index]!);
  };

  return (
    <ScrollView
      ref={ref}
      style={styles.dateWheelColumn}
      contentContainerStyle={styles.wheelColumnContent}
      showsVerticalScrollIndicator={false}
      snapToInterval={WHEEL_ITEM_HEIGHT}
      decelerationRate="fast"
      onMomentumScrollEnd={finish}
      onScrollEndDrag={finish}
    >
      {values.map((value) => (
        <View key={value} style={styles.wheelItem}>
          <Text style={[styles.wheelItemText, value === selected && styles.wheelItemTextSelected]}>{value}</Text>
          <Text style={styles.wheelSuffix}>{suffix}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function BirthDatePickerField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const initial = value.split('-').map(Number);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(initial[0] || new Date().getFullYear());
  const [month, setMonth] = useState(initial[1] || new Date().getMonth() + 1);
  const [day, setDay] = useState(initial[2] || new Date().getDate());
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => index + 1);

  useEffect(() => {
    if (day > daysInMonth) setDay(daysInMonth);
  }, [day, daysInMonth]);

  const openPicker = () => {
    Keyboard.dismiss();
    setOpen(true);
  };

  return (
    <>
      <TouchableOpacity style={styles.birthDateButton} onPress={openPicker} activeOpacity={0.72}>
        <Icon name="calendar-heart" size={20} color={C.peach} />
        <Text style={styles.birthDateValue}>{formatBirthDate(value)}</Text>
        <Text style={styles.timePickerHint}>滑动选择</Text>
        <Icon name="chevron-down" size={18} color={C.muted} />
      </TouchableOpacity>
      {open && <Modal visible transparent animationType="fade" statusBarTranslucent hardwareAccelerated onRequestClose={() => setOpen(false)}>
        <View style={styles.wheelModalRoot}>
          <Pressable style={styles.wheelBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.wheelSheet}>
            <View style={styles.wheelHeader}>
              <TouchableOpacity onPress={() => setOpen(false)}><Text style={styles.wheelCancel}>取消</Text></TouchableOpacity>
              <View style={styles.wheelHeaderTitleWrap}>
                <Text style={styles.wheelTitle}>选择出生日期</Text>
                <Text style={styles.wheelSelectedValue}>{year}-{String(month).padStart(2, '0')}-{String(day).padStart(2, '0')}</Text>
              </View>
              <TouchableOpacity onPress={() => {
                onChange(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
                setOpen(false);
              }}><Text style={[styles.wheelDone, { color: C.peach }]}>完成</Text></TouchableOpacity>
            </View>
            <View style={styles.wheelsWrap}>
              <View pointerEvents="none" style={[styles.wheelSelection, { borderColor: `${C.peach}38`, backgroundColor: `${C.peach}12` }]} />
              <DateWheelColumn values={BIRTH_YEARS} selected={year} suffix="年" onChange={setYear} />
              <DateWheelColumn values={months} selected={month} suffix="月" onChange={setMonth} />
              <DateWheelColumn values={days} selected={day} suffix="日" onChange={setDay} />
            </View>
          </View>
        </View>
      </Modal>}
    </>
  );
}

function BabyProfileSheet({ visible, profile, onClose, onSave }: { visible: boolean; profile: BabyProfile; onClose: () => void; onSave: (profile: BabyProfile) => void }) {
  const [name, setName] = useState(profile.name);
  const [birthDate, setBirthDate] = useState(profile.birthDate);

  useEffect(() => {
    if (!visible) return;
    setName(profile.name);
    setBirthDate(profile.birthDate);
  }, [visible, profile]);

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  const save = () => {
    Keyboard.dismiss();
    onSave({ name: name.trim(), birthDate });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent hardwareAccelerated onRequestClose={close}>
      <StableKeyboardRoot style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, styles.profileSheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderButton} />
            <View style={styles.sheetTitleWrap}><Text style={styles.sheetTitle}>宝宝资料</Text><Text style={styles.sheetSubtitle}>年龄将根据出生日期自动更新</Text></View>
            <TouchableOpacity style={styles.sheetHeaderButton} onPress={close}><Icon name="close" size={21} /></TouchableOpacity>
          </View>
          <View style={styles.profileForm}>
            <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{(name || '宝').slice(-1)}</Text></View>
            <Field label="宝宝昵称">
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="例如：小满" placeholderTextColor="#A6ADB6" />
            </Field>
            <Field label="出生日期">
              <BirthDatePickerField value={birthDate} onChange={setBirthDate} />
              <View style={styles.agePreview}><Icon name="cake-variant-outline" size={16} color={C.sage} /><Text style={styles.agePreviewText}>当前年龄：{babyAgeFromBirthDate(birthDate)}</Text></View>
            </Field>
            <TouchableOpacity style={[styles.saveButton, { backgroundColor: name.trim() ? C.peach : '#C9CDD2' }]} disabled={!name.trim()} onPress={save}>
              <Icon name="check" size={19} color="#FFFFFF" /><Text style={styles.saveButtonText}>保存宝宝资料</Text>
            </TouchableOpacity>
          </View>
        </View>
      </StableKeyboardRoot>
    </Modal>
  );
}

function SyncEndpointSheet({ endpoint, password, onClose, onSave }: { endpoint: string; password: string; onClose: () => void; onSave: (endpoint: string, password: string) => void }) {
  const [draft, setDraft] = useState(endpoint);
  const [draftPassword, setDraftPassword] = useState(password);
  const [showPassword, setShowPassword] = useState(false);

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  const save = () => {
    if (!draft.trim().startsWith('https://')) {
      Alert.alert('接口地址无效', '为保护宝宝数据，同步接口必须使用 HTTPS。');
      return;
    }
    if (!draftPassword.trim()) {
      Alert.alert('请输入同步密码', '同步密码仅保存在当前 Android 设备中，不会写入项目源码。');
      return;
    }
    Keyboard.dismiss();
    onSave(draft, draftPassword.trim());
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent hardwareAccelerated onRequestClose={close}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, styles.syncSheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderButton} />
            <View style={styles.sheetTitleWrap}><Text style={styles.sheetTitle}>同步接口设置</Text><Text style={styles.sheetSubtitle}>仅用于 Android 客户端</Text></View>
            <TouchableOpacity style={styles.sheetHeaderButton} onPress={close}><Icon name="close" size={21} /></TouchableOpacity>
          </View>
          <View style={styles.profileForm}>
            <View style={[styles.projectPreview, { backgroundColor: C.sageSoft }]}><Icon name="api" size={31} color={C.sage} /></View>
            <Field label="HTTPS 接口地址">
              <TextInput style={[styles.input, styles.endpointInput]} value={draft} onChangeText={setDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} />
              <Text style={styles.endpointHint}>Docker Compose 后端将通过此地址提供登录、记录和增量同步接口。</Text>
            </Field>
            <Field label="同步密码">
              <View style={styles.passwordInputWrap}>
                <TextInput style={styles.passwordInput} value={draftPassword} onChangeText={setDraftPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} placeholder="输入服务器同步密码" placeholderTextColor="#A6ADB6" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} />
                <TouchableOpacity style={styles.passwordEyeButton} onPress={() => setShowPassword((current) => !current)}><Icon name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.muted} /></TouchableOpacity>
              </View>
              <Text style={styles.endpointHint}>密码只保存在本机；服务器正确密码由 Docker Compose 环境变量提供。</Text>
            </Field>
            <TouchableOpacity style={[styles.saveButton, { backgroundColor: C.sage }]} onPress={save}>
              <Icon name="content-save-outline" size={19} color="#FFFFFF" /><Text style={styles.saveButtonText}>保存接口地址</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RoleManagementSheet({ visible, roles, currentRole, onClose, onSave }: { visible: boolean; roles: SavedRole[]; currentRole: SavedRole; onClose: () => void; onSave: (roles: SavedRole[]) => Promise<void> }) {
  const [draftRoles, setDraftRoles] = useState(roles);
  const [newRoleName, setNewRoleName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraftRoles(roles);
    setNewRoleName('');
  }, [visible, roles]);

  const removeRole = (role: SavedRole) => {
    if (role.id === currentRole.id) return;
    if (role.isAdmin && draftRoles.filter((item) => item.isAdmin).length <= 1) {
      Alert.alert('无法删除', '家庭中至少需要保留一个管理员角色。');
      return;
    }
    Alert.alert('删除用户？', `将删除“${role.name}”的角色入口，但不会删除宝宝记录。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => setDraftRoles((current) => current.filter((item) => item.id !== role.id)) },
    ]);
  };

  const addRole = () => {
    const name = newRoleName.trim();
    if (!name) return;
    setDraftRoles((current) => [...current, { id: `family:${Date.now()}`, name, isAdmin: false, createdAt: new Date().toISOString() }]);
    setNewRoleName('');
  };

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  const save = async () => {
    Keyboard.dismiss();
    setSaving(true);
    await onSave(draftRoles.map((role) => ({ ...role, name: role.name.trim() })));
    setSaving(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent hardwareAccelerated onRequestClose={close}>
      <StableKeyboardRoot style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, styles.managementSheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderButton} />
            <View style={styles.sheetTitleWrap}><Text style={styles.sheetTitle}>用户与权限</Text><Text style={styles.sheetSubtitle}>仅管理员可以修改或删除角色</Text></View>
            <TouchableOpacity style={styles.sheetHeaderButton} onPress={close}><Icon name="close" size={21} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.managementForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.adminInfoCard}><Icon name="shield-check-outline" size={22} color={C.peach} /><Text style={styles.adminInfoText}>爸爸、妈妈默认为管理员。当前正在使用的角色不能删除，家庭至少保留一名管理员。</Text></View>
            <Text style={styles.managementLabel}>现有用户</Text>
            <View style={styles.managementList}>
              {draftRoles.map((role) => (
                <View key={role.id} style={styles.managementRow}>
                  <View style={[styles.managementIcon, { backgroundColor: role.isAdmin ? C.peachSoft : C.sageSoft }]}><Icon name={roleIcon(role)} size={20} color={role.isAdmin ? C.peach : C.sage} /></View>
                  <View style={styles.managementCopy}>
                    <TextInput
                      value={role.name}
                      onChangeText={(name) => setDraftRoles((current) => current.map((item) => item.id === role.id ? { ...item, name } : item))}
                      style={styles.managementNameInput}
                      maxLength={12}
                    />
                    <Text style={styles.managementMeta}>{role.isAdmin ? '管理员' : '普通用户'}</Text>
                  </View>
                  {role.id === currentRole.id ? <Text style={styles.currentRoleTag}>当前</Text> : <TouchableOpacity style={styles.deleteRoleButton} onPress={() => removeRole(role)}><Icon name="trash-can-outline" size={20} color={C.danger} /></TouchableOpacity>}
                </View>
              ))}
            </View>
            <Text style={styles.managementLabel}>添加普通用户</Text>
            <View style={styles.addRoleRow}>
              <TextInput style={[styles.input, { flex: 1 }]} value={newRoleName} onChangeText={setNewRoleName} placeholder="输入角色名称" placeholderTextColor="#A6ADB6" maxLength={12} />
              <TouchableOpacity style={[styles.addRoleButton, !newRoleName.trim() && { opacity: 0.45 }]} disabled={!newRoleName.trim()} onPress={addRole}><Icon name="plus" size={23} color="#FFFFFF" /></TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.saveButton, { backgroundColor: C.navy }]} disabled={saving || draftRoles.some((role) => !role.name.trim())} onPress={save}>
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <><Icon name="check" size={19} color="#FFFFFF" /><Text style={styles.saveButtonText}>保存用户设置</Text></>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </StableKeyboardRoot>
    </Modal>
  );
}

function BackupRestoreSheet({ visible, backups, onClose, onBackupNow, onRestore }: { visible: boolean; backups: DailyBackup[]; onClose: () => void; onBackupNow: () => Promise<void>; onRestore: (backup: DailyBackup) => Promise<void> }) {
  const [working, setWorking] = useState(false);
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent hardwareAccelerated onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, styles.backupSheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderButton} />
            <View style={styles.sheetTitleWrap}><Text style={styles.sheetTitle}>备份与恢复</Text><Text style={styles.sheetSubtitle}>每天一份 · 滚动保留最近 30 天</Text></View>
            <TouchableOpacity style={styles.sheetHeaderButton} onPress={onClose}><Icon name="close" size={21} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.backupContent} showsVerticalScrollIndicator={false}>
            <View style={styles.backupPolicyCard}>
              <View style={styles.backupPolicyIcon}><Icon name="backup-restore" size={25} color={C.blue} /></View>
              <View style={styles.backupPolicyCopy}><Text style={styles.backupPolicyTitle}>每日自动备份已开启</Text><Text style={styles.backupPolicyText}>每天首次打开时创建当日快照，同一天手动备份会更新该快照。</Text></View>
            </View>
            <TouchableOpacity style={[styles.saveButton, { backgroundColor: C.blue }]} disabled={working} onPress={async () => { setWorking(true); await onBackupNow(); setWorking(false); }}>
              {working ? <ActivityIndicator color="#FFFFFF" /> : <><Icon name="cloud-upload-outline" size={20} color="#FFFFFF" /><Text style={styles.saveButtonText}>立即更新今日备份</Text></>}
            </TouchableOpacity>
            <View style={styles.backupHeadingRow}><Text style={styles.managementLabel}>最近备份</Text><Text style={styles.backupCountText}>{backups.length}/30</Text></View>
            {backups.length ? backups.map((backup, index) => (
              <TouchableOpacity key={backup.id} style={styles.backupRow} activeOpacity={0.72} onPress={() => Alert.alert('恢复这份备份？', `将把宝宝资料和记录恢复到 ${backup.localDate} 的状态。`, [{ text: '取消', style: 'cancel' }, { text: '恢复', onPress: () => onRestore(backup) }])}>
                <View style={[styles.backupDateBadge, index === 0 && { backgroundColor: C.blueSoft }]}><Icon name={index === 0 ? 'check-decagram-outline' : 'archive-clock-outline'} size={21} color={index === 0 ? C.blue : C.muted} /></View>
                <View style={styles.settingsRowCopy}><Text style={styles.backupRowTitle}>{backup.localDate}</Text><Text style={styles.backupRowText}>{new Date(backup.createdAt).toLocaleString()} · 数据架构 v{backup.schemaVersion}</Text></View>
                {index === 0 && <Text style={styles.latestBackupTag}>最新</Text>}
                <Icon name="restore" size={20} color={C.blue} />
              </TouchableOpacity>
            )) : <View style={styles.backupEmpty}><Icon name="archive-outline" size={30} color={C.muted} /><Text style={styles.backupEmptyText}>还没有备份</Text></View>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ProjectSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (project: CustomProject) => void }) {
  const [name, setName] = useState('');
  const [colorIndex, setColorIndex] = useState(0);
  const [iconIndex, setIconIndex] = useState(0);
  const [timeMode, setTimeMode] = useState<TimeMode>('instant');
  const colors = [
    { color: C.pink, soft: C.pinkSoft }, { color: C.sage, soft: C.sageSoft }, { color: C.blue, soft: C.blueSoft }, { color: C.peach, soft: C.peachSoft }, { color: C.lavender, soft: C.lavenderSoft },
  ];
  const selectedColor = colors[colorIndex]!;
  const selectedIcon = BABY_PROJECT_ICONS[iconIndex]!;
  const close = () => {
    Keyboard.dismiss();
    onClose();
  };
  const save = () => {
    Keyboard.dismiss();
    onSave({ id: String(Date.now()), name: name.trim(), icon: selectedIcon.name, timeMode, ...selectedColor });
    setName('');
    setIconIndex(0);
    setTimeMode('instant');
  };
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent hardwareAccelerated onRequestClose={close}>
      <StableKeyboardRoot style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, styles.projectSheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderButton} />
            <View style={styles.sheetTitleWrap}><Text style={styles.sheetTitle}>新建自定义项目</Text><Text style={styles.sheetSubtitle}>创建你们家的专属记录</Text></View>
            <TouchableOpacity style={styles.sheetHeaderButton} onPress={close}><Icon name="close" size={21} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.projectForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={[styles.projectPreview, { backgroundColor: selectedColor.soft }]}><Icon name={selectedIcon.name} size={31} color={selectedColor.color} /></View>
            <Field label="项目名称">
              <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="例如：辅食" placeholderTextColor="#A6ADB6" autoFocus />
            </Field>
            <Field label="记录时间类型">
              <View style={styles.projectModeRow}>
                <TouchableOpacity style={[styles.projectModeCard, timeMode === 'instant' && { backgroundColor: selectedColor.soft, borderColor: selectedColor.color }]} onPress={() => setTimeMode('instant')}>
                  <Icon name="clock-time-eight-outline" size={22} color={timeMode === 'instant' ? selectedColor.color : C.muted} />
                  <Text style={[styles.projectModeTitle, timeMode === 'instant' && { color: selectedColor.color }]}>时刻</Text>
                  <Text style={styles.projectModeHint}>如辅食、体温</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.projectModeCard, timeMode === 'range' && { backgroundColor: selectedColor.soft, borderColor: selectedColor.color }]} onPress={() => setTimeMode('range')}>
                  <Icon name="timeline-clock-outline" size={22} color={timeMode === 'range' ? selectedColor.color : C.muted} />
                  <Text style={[styles.projectModeTitle, timeMode === 'range' && { color: selectedColor.color }]}>时间段</Text>
                  <Text style={styles.projectModeHint}>如洗澡、散步</Text>
                </TouchableOpacity>
              </View>
            </Field>
            <Field label="选择图标">
              <View style={styles.projectIconGrid}>
                {BABY_PROJECT_ICONS.map((item, index) => (
                  <TouchableOpacity key={item.name} style={[styles.projectIconChoice, iconIndex === index && { backgroundColor: selectedColor.soft, borderColor: selectedColor.color }]} onPress={() => setIconIndex(index)}>
                    <Icon name={item.name} size={22} color={iconIndex === index ? selectedColor.color : C.muted} />
                    <Text numberOfLines={1} style={[styles.projectIconLabel, iconIndex === index && { color: selectedColor.color }]}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>
            <Field label="选择颜色">
              <View style={styles.colorRow}>{colors.map((item, index) => <TouchableOpacity key={item.color} style={[styles.colorDotOuter, colorIndex === index && { borderColor: item.color }]} onPress={() => setColorIndex(index)}><View style={[styles.colorDot, { backgroundColor: item.color }]} /></TouchableOpacity>)}</View>
            </Field>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: name.trim() ? selectedColor.color : '#C9CDD2' }]}
              disabled={!name.trim()}
              onPress={save}
            >
              <Icon name="plus" size={19} color="#FFFFFF" /><Text style={styles.saveButtonText}>创建项目</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </StableKeyboardRoot>
    </Modal>
  );
}

function RecordDetailSheet({ item, existingItems, onClose, onDelete, onSave }: { item: TimelineItem | null; existingItems: TimelineItem[]; onClose: () => void; onDelete: () => void; onSave: (item: TimelineItem) => void }) {
  const type = typeFor(item?.kind ?? 'custom');
  const [title, setTitle] = useState(item?.title ?? '');
  const [time, setTime] = useState(item?.time ?? '');
  const [endTime, setEndTime] = useState(item?.endTime ?? '');
  const [detail, setDetail] = useState(item?.detail ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  if (!item) return null;
  const rangeItem = isRangeItem(item);
  const buildEdited = (nextEndTime = endTime): TimelineItem => ({
      ...item,
      title: title.trim() || item.title,
      time,
      endTime: nextEndTime || undefined,
      detail: rangeItem && nextEndTime ? sleepDurationText(time, nextEndTime) : detail,
      note: note || undefined,
      ongoing: rangeItem ? !nextEndTime : false,
    });
  const saveEdited = (nextEndTime = endTime) => {
    Keyboard.dismiss();
    const candidate = buildEdited(nextEndTime);
    const conflict = findRangeConflict(candidate, existingItems);
    if (conflict) {
      Alert.alert(
        '时间段有重叠',
        `与“${conflict.title}”的 ${conflict.time}${conflict.endTime ? `–${conflict.endTime}` : '–进行中'} 重叠，请确认是否仍要保存。`,
        [{ text: '返回调整', style: 'cancel' }, { text: '仍然保存', onPress: () => onSave(candidate) }],
      );
      return;
    }
    onSave(candidate);
  };
  const editingConflict = rangeItem ? findRangeConflict(buildEdited(endTime || nowTime()), existingItems) : undefined;
  const close = () => {
    Keyboard.dismiss();
    onClose();
  };
  const deleteRecord = () => {
    Keyboard.dismiss();
    onDelete();
  };
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent hardwareAccelerated onRequestClose={close}>
      <StableKeyboardRoot style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, styles.editSheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <TouchableOpacity style={styles.sheetHeaderButton} onPress={() => Alert.alert('删除记录？', '删除后将无法恢复。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: deleteRecord }])}><Icon name="trash-can-outline" size={20} color={C.danger} /></TouchableOpacity>
            <View style={styles.sheetTitleWrap}><Text style={styles.sheetTitle}>编辑记录</Text><Text style={styles.sheetSubtitle}>像编辑日历事件一样调整</Text></View>
            <TouchableOpacity style={styles.sheetHeaderButton} onPress={close}><Icon name="close" size={21} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.editForm} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.editCategoryRow}>
              <View style={[styles.editCategoryIcon, { backgroundColor: type.soft }]}><Icon name={type.icon} size={21} color={type.color} /></View>
              <View>
                <Text style={styles.editCategoryLabel}>记录类型</Text>
                <Text style={[styles.editCategoryName, { color: type.color }]}>{type.label}</Text>
              </View>
            </View>
            {rangeItem && item.ongoing && (
              <TouchableOpacity
                style={[styles.finishSleepButton, { backgroundColor: type.color }]}
                onPress={() => saveEdited(nowTime())}
                activeOpacity={0.8}
              >
                <View style={styles.finishSleepPulse} />
                <View style={styles.finishSleepCopy}>
                  <Text style={styles.finishSleepTitle}>现在结束{item.kind === 'sleep' ? '睡眠' : '记录'}</Text>
                  <Text style={styles.finishSleepHint}>自动填写当前时间并完成计时</Text>
                </View>
                <Icon name="stop-circle-outline" size={25} color="#FFFFFF" />
              </TouchableOpacity>
            )}
            <Field label="标题">
              <TextInput style={styles.input} value={title} onChangeText={setTitle} />
            </Field>
            <Field label={rangeItem ? '开始时间' : '记录时间'}>
              <TimePickerField value={time} onChange={setTime} color={type.color} />
            </Field>
            {!!endTime && (
              <Field label="结束时间">
                <TimePickerField value={endTime} onChange={setEndTime} color={type.color} />
                {rangeItem && <View style={styles.durationPreview}><Icon name="clock-check-outline" size={15} color={type.color} /><Text style={[styles.durationPreviewText, { color: type.color }]}>持续时间 {sleepDurationText(time, endTime)}</Text></View>}
              </Field>
            )}
            {rangeItem && editingConflict && (
              <View style={styles.timeConflictNotice}>
                <Icon name="alert-circle-outline" size={19} color={C.danger} />
                <View style={styles.timeConflictCopy}><Text style={styles.timeConflictTitle}>与“{editingConflict.title}”时间重叠</Text><Text style={styles.timeConflictText}>保存时会再次确认</Text></View>
              </View>
            )}
            <Field label="记录内容">
              <TextInput style={styles.input} value={detail} onChangeText={setDetail} />
            </Field>
            <Field label="备注（可选）">
              <TextInput style={[styles.input, styles.noteInput]} value={note} onChangeText={setNote} multiline placeholder="添加备注" placeholderTextColor="#A6ADB6" />
            </Field>
            <TouchableOpacity style={[styles.saveButton, { backgroundColor: type.color }]} onPress={() => saveEdited()}>
              <Icon name="check" size={19} color="#FFFFFF" />
              <Text style={styles.saveButtonText}>完成</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </StableKeyboardRoot>
    </Modal>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  roleSafe: { flex: 1, backgroundColor: C.canvas, paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 },
  roleLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  rolePage: { flexGrow: 1, width: '100%', maxWidth: 540, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 36 },
  roleBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 34 },
  roleBrandIcon: { width: 58, height: 58, borderRadius: 21, backgroundColor: C.peachSoft, alignItems: 'center', justifyContent: 'center' },
  roleBrandName: { color: C.ink, fontSize: 24, fontWeight: '800' },
  roleBrandSubtitle: { color: C.muted, fontSize: 13, marginTop: 4 },
  pinCard: { backgroundColor: C.paper, borderRadius: 25, borderWidth: 1, borderColor: '#E7E8E5', padding: 20, shadowColor: C.navy, shadowOpacity: 0.06, shadowRadius: 14, elevation: 2 },
  roleSelectCard: { backgroundColor: C.paper, borderRadius: 25, borderWidth: 1, borderColor: '#E7E8E5', padding: 18 },
  roleStepBadge: { alignSelf: 'flex-start', borderRadius: 9, backgroundColor: C.blueSoft, paddingHorizontal: 9, paddingVertical: 5, marginBottom: 13 },
  roleStepText: { color: C.blue, fontSize: 11, fontWeight: '800' },
  roleTitle: { color: C.ink, fontSize: 25, fontWeight: '800' },
  roleDescription: { color: C.muted, fontSize: 14, lineHeight: 22, marginTop: 8, marginBottom: 22 },
  pinInputWrap: { height: 56, borderRadius: 15, borderWidth: 1.5, borderColor: '#DDE0DE', backgroundColor: '#FBFBF9', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  pinInputError: { borderColor: C.danger, backgroundColor: '#FFF9F9' },
  pinInput: { flex: 1, color: C.ink, fontSize: 20, fontWeight: '800', letterSpacing: 4, marginLeft: 9 },
  pinCount: { color: C.muted, fontSize: 11 },
  pinErrorText: { color: C.danger, fontSize: 12, marginTop: 7, paddingLeft: 3 },
  rolePrimaryButton: { minHeight: 54, borderRadius: 16, backgroundColor: C.navy, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  roleButtonDisabled: { backgroundColor: '#B8BDC4' },
  rolePrimaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  localRoleNote: { backgroundColor: C.sageSoft, borderRadius: 13, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14 },
  localRoleNoteText: { flex: 1, color: '#5E776E', fontSize: 12, lineHeight: 18 },
  roleBackButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 16, paddingVertical: 4 },
  roleBackText: { color: C.ink, fontSize: 13, fontWeight: '700' },
  roleAccessBadge: { alignSelf: 'flex-start', backgroundColor: C.sageSoft, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 13 },
  roleAdminBadge: { backgroundColor: C.peachSoft },
  roleAccessText: { color: C.sage, fontSize: 12, fontWeight: '800' },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  roleChoiceCard: { width: '48.5%', minHeight: 68, borderRadius: 16, borderWidth: 1.5, borderColor: '#E0E2DF', backgroundColor: '#FAFAF8', paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleChoiceActive: { borderColor: C.navy, backgroundColor: '#F1F3F6' },
  roleChoiceIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: C.sageSoft, alignItems: 'center', justifyContent: 'center' },
  roleChoiceCopy: { flex: 1 },
  roleChoiceName: { color: C.ink, fontSize: 14, fontWeight: '800' },
  roleChoiceMeta: { color: C.muted, fontSize: 10, marginTop: 3 },
  roleOrRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginVertical: 20 },
  roleOrLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#DCDDDA' },
  roleOrText: { color: C.muted, fontSize: 12 },
  roleAutoSaveText: { color: C.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 11 },
  adminPinModalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  adminPinCard: { width: '100%', maxWidth: 430, backgroundColor: C.paper, borderRadius: 25, padding: 20, zIndex: 2, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 20, elevation: 10 },
  adminPinIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: C.peachSoft, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  adminPinTitle: { color: C.ink, fontSize: 21, fontWeight: '800', textAlign: 'center', marginTop: 13 },
  adminPinDescription: { color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 6, marginBottom: 18 },
  adminPinCancel: { height: 42, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  adminPinCancelText: { color: C.muted, fontSize: 14, fontWeight: '700' },
  safe: { flex: 1, backgroundColor: C.canvas, paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 },
  app: { flex: 1, backgroundColor: C.canvas },
  screen: { flex: 1 },
  todayContent: { flex: 1, paddingHorizontal: 14, paddingTop: 7, paddingBottom: 128 },
  todayContentElder: { paddingBottom: 151 },
  todayMain: { flex: 1, minHeight: 0 },
  todayTopBar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  todayTitle: { color: C.ink, fontSize: 23, fontWeight: '800' },
  todaySubtitle: { color: C.muted, fontSize: 12, marginTop: 3 },
  calendarEntryButton: { height: 36, borderRadius: 12, paddingHorizontal: 11, backgroundColor: C.paper, borderWidth: 1, borderColor: '#E6E7E4', flexDirection: 'row', alignItems: 'center', gap: 5 },
  calendarEntryText: { color: C.navy, fontSize: 13, fontWeight: '800' },
  ongoingPanel: { backgroundColor: C.paper, borderRadius: 15, padding: 10, marginTop: 7, borderWidth: 1, borderColor: '#E2E3E0' },
  ongoingHeader: { minHeight: 27, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  ongoingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  ongoingPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.danger },
  ongoingTitle: { color: C.ink, fontSize: 15, fontWeight: '800' },
  ongoingCount: { color: C.muted, fontSize: 11, fontWeight: '700' },
  ongoingCard: { minHeight: 54, borderRadius: 12, borderLeftWidth: 4, backgroundColor: '#FAFAF8', paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  ongoingIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  ongoingCopy: { flex: 1, minWidth: 0 },
  ongoingName: { color: C.ink, fontSize: 13, fontWeight: '800' },
  ongoingMeta: { color: C.muted, fontSize: 10, marginTop: 3 },
  ongoingChooseButton: { minWidth: 54, height: 37, borderRadius: 11, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper, borderWidth: 1, borderColor: '#E1E2DF', marginLeft: 5 },
  ongoingChooseText: { fontSize: 9, fontWeight: '800', marginTop: 1 },
  ongoingNowButton: { minHeight: 37, borderRadius: 11, paddingHorizontal: 9, marginLeft: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  ongoingNowText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  pageContent: { paddingHorizontal: 20, paddingTop: 20 },
  calendarPageContent: { paddingHorizontal: 20, paddingTop: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  greeting: { color: C.muted, fontSize: 11, marginBottom: 4, fontWeight: '500' },
  babySwitcher: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 35, height: 35, borderRadius: 13, backgroundColor: C.peachSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.peach, fontSize: 16, fontWeight: '800' },
  babyName: { color: C.ink, fontWeight: '800', fontSize: 18, letterSpacing: 0.2 },
  babyAge: { color: C.muted, fontSize: 12, marginTop: 2 },
  roundButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ECECE9', position: 'relative' },
  notificationDot: { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: C.peach, borderWidth: 1.5, borderColor: C.paper },
  monthRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, marginBottom: 5 },
  monthText: { color: C.ink, fontWeight: '700', fontSize: 12 },
  dateStrip: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.paper, borderRadius: 16, padding: 3, borderWidth: 1, borderColor: '#ECECE9' },
  dayItem: { width: (SCREEN_WIDTH - 42) / 7, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dayItemActive: { backgroundColor: C.navy },
  weekText: { color: '#9AA1AA', fontSize: 9, marginBottom: 2, fontWeight: '600' },
  dayText: { color: C.ink, fontSize: 14, fontWeight: '700' },
  dayTextActive: { color: '#FFFFFF' },
  dayDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: C.peach, marginTop: 4 },
  todoPanel: { backgroundColor: C.paper, borderRadius: 15, paddingHorizontal: 11, paddingTop: 8, paddingBottom: 5, marginTop: 7, borderWidth: 1, borderColor: '#E9E9E6' },
  todoPanelElder: { borderRadius: 20, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  todoPanelCollapsed: { paddingBottom: 4 },
  todoPanelCollapsedElder: { paddingBottom: 12 },
  todoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  todoHeaderElder: { flexDirection: 'column', alignItems: 'stretch', gap: 8, marginBottom: 8 },
  todoTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  todoCollapseMeta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  todoCollapseMetaElder: { alignSelf: 'stretch', justifyContent: 'space-between', gap: 8 },
  todoSpark: { width: 25, height: 25, borderRadius: 9, backgroundColor: C.peachSoft, alignItems: 'center', justifyContent: 'center' },
  todoSparkElder: { width: 38, height: 38, borderRadius: 13 },
  todoTitle: { color: C.ink, fontSize: 16, fontWeight: '800' },
  todoProgress: { color: C.muted, backgroundColor: '#F0F1EF', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, fontSize: 11, fontWeight: '700' },
  todoSource: { color: '#8D949D', fontSize: 11 },
  todoRows: { gap: 1 },
  todoRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  todoRowElder: { minHeight: 116, alignItems: 'flex-start', paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#EEEFEA' },
  todoLeading: { flexDirection: 'row', alignItems: 'center' },
  todoLeadingElder: { paddingTop: 4 },
  todoCheck: { width: 17, height: 17, borderRadius: 6, borderWidth: 1.5, borderColor: '#C9CDD1', alignItems: 'center', justifyContent: 'center', marginRight: 7 },
  todoCheckElder: { width: 25, height: 25, borderRadius: 8, marginRight: 9 },
  todoTypeDot: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 7 },
  todoTypeDotElder: { width: 38, height: 38, borderRadius: 12, marginRight: 12 },
  todoTime: { color: C.ink, fontSize: 13, fontWeight: '800', width: 46 },
  todoCopy: { flex: 1, flexDirection: 'column', justifyContent: 'center' },
  todoCopyElder: { justifyContent: 'flex-start', minWidth: 0, paddingRight: 6 },
  todoTimeElder: { color: C.peach, fontSize: 16, fontWeight: '800', marginBottom: 5 },
  todoName: { color: C.ink, fontSize: 14, fontWeight: '700' },
  todoReason: { color: C.muted, fontSize: 11, marginTop: 2 },
  todoTextDone: { textDecorationLine: 'line-through', color: '#A9AFB6' },
  calendarHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 7, marginBottom: 5 },
  calendarTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  calendarTitle: { color: C.ink, fontSize: 18, fontWeight: '800' },
  recordCountBadge: { backgroundColor: '#EDEEEB', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3 },
  recordCountText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  calendarHint: { color: C.muted, fontSize: 11 },
  calendarGrid: { flex: 1, minHeight: 270, backgroundColor: C.paper, borderRadius: 17, borderWidth: 1, borderColor: '#E7E8E5', overflow: 'hidden' },
  calendarScroll: { flex: 1 },
  calendarScrollContent: { paddingVertical: 8 },
  calendarScrollable: { flexDirection: 'row' },
  calendarAxis: { width: 50, backgroundColor: '#F2F2EF', position: 'relative' },
  calendarAxisElder: { width: 78 },
  calendarHour: { position: 'absolute', right: 7, color: '#7E8792', fontSize: 10, fontWeight: '600', transform: [{ translateY: -6 }] },
  calendarHourElder: { right: 10, transform: [{ translateY: -10 }] },
  calendarCanvas: { flex: 1, position: 'relative' },
  calendarLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: '#E5E6E4' },
  calendarEvent: { position: 'absolute', left: 6, right: 7, minHeight: 30, borderLeftWidth: 4, borderRadius: 8, paddingHorizontal: 8, justifyContent: 'center', zIndex: 2, overflow: 'hidden' },
  calendarEventElder: { minHeight: 64, paddingHorizontal: 11, borderLeftWidth: 5 },
  calendarEventPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  calendarEventTop: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 },
  calendarEventTopElder: { alignItems: 'flex-start', minHeight: 56, paddingVertical: 6, gap: 9 },
  calendarEventCopyElder: { flex: 1, minWidth: 0 },
  calendarEventTitle: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
  calendarEventTime: { fontSize: 10, fontWeight: '700', marginLeft: 'auto' },
  calendarEventTimeElder: { marginLeft: 0, marginTop: 3 },
  calendarLiveDot: { width: 5, height: 5, borderRadius: 3, marginLeft: 'auto' },
  calendarLiveDotElder: { width: 9, height: 9, borderRadius: 5, marginTop: 8 },
  calendarInstantEvent: { position: 'absolute', left: 7, right: 7, height: 36, zIndex: 3, flexDirection: 'row', alignItems: 'center', transform: [{ translateY: -18 }] },
  calendarInstantEventElder: { height: 54, transform: [{ translateY: -27 }] },
  calendarInstantEventBent: { height: 62, transform: [{ translateY: -31 }] },
  calendarInstantEventBentElder: { height: 86, transform: [{ translateY: -43 }] },
  calendarInstantMarker: { width: 3, height: 28, borderRadius: 2 },
  calendarInstantMarkerElder: { width: 5, height: 44, borderRadius: 3 },
  calendarInstantRule: { flex: 1, height: 1, marginLeft: 4 },
  calendarBentConnector: { flex: 1, height: 62, marginLeft: 4, position: 'relative' },
  calendarBentConnectorElder: { height: 86 },
  calendarBendTop: { position: 'absolute', left: 0, right: '35%', top: 30, height: 1 },
  calendarBendVertical: { position: 'absolute', right: '35%', top: 30, width: 1, height: 14 },
  calendarBendBottom: { position: 'absolute', left: '65%', right: 0, top: 43, height: 1 },
  calendarInstantTag: { width: '58%', minWidth: 142, height: 34, borderRadius: 10, borderWidth: 1, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 6 },
  calendarInstantTagElder: { width: '72%', minWidth: 194, height: 52, borderRadius: 13, paddingHorizontal: 9, gap: 8 },
  calendarInstantTagBent: { transform: [{ translateY: 13 }] },
  calendarInstantTagBentElder: { transform: [{ translateY: 18 }] },
  calendarInstantIcon: { width: 23, height: 23, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  calendarInstantIconElder: { width: 34, height: 34, borderRadius: 11 },
  calendarInstantCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  calendarInstantTitle: { flex: 1, fontSize: 12, fontWeight: '800' },
  calendarInstantTime: { fontSize: 10, fontWeight: '800' },
  calendarInstantTimeElder: { marginTop: 1 },
  nowLine: { position: 'absolute', left: -4, right: 7, minHeight: 24, zIndex: 6, flexDirection: 'row', alignItems: 'center', transform: [{ translateY: -12 }] },
  nowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.danger },
  nowRule: { flex: 1, height: 1, backgroundColor: C.danger },
  nowLabel: { color: C.danger, backgroundColor: '#FCEAEA', borderRadius: 7, minWidth: 68, lineHeight: 16, paddingHorizontal: 7, paddingVertical: 3, fontSize: 10, fontWeight: '800', textAlign: 'center', marginHorizontal: 5 },
  summaryCard: { backgroundColor: C.navy, borderRadius: 25, padding: 20, marginTop: 18, shadowColor: C.navy, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 4 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  summaryEyebrow: { color: '#AEB9C9', fontSize: 11, fontWeight: '600', marginBottom: 4 },
  summaryHeadline: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  scoreBadge: { backgroundColor: '#344963', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', gap: 5, alignItems: 'center' },
  scoreText: { color: '#CFE4DA', fontSize: 11, fontWeight: '700' },
  summaryMetrics: { flexDirection: 'row', alignItems: 'center', marginTop: 22 },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginTop: 6 },
  metricLabel: { color: '#AEB9C9', fontSize: 10, marginTop: 3 },
  metricDivider: { width: 1, height: 34, backgroundColor: '#43536A' },
  sectionTitleRow: { marginTop: 28, marginBottom: 17, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sectionEyebrow: { color: C.muted, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  sectionTitle: { color: C.ink, fontSize: 21, fontWeight: '800' },
  filterButton: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch', minHeight: 90 },
  timeColumn: { width: 43, paddingTop: 4, alignItems: 'flex-end' },
  timeText: { color: C.ink, fontSize: 12, fontWeight: '700' },
  endTimeText: { color: '#A1A8B1', fontSize: 9, marginTop: 7 },
  railColumn: { width: 33, alignItems: 'center' },
  timelineDot: { width: 25, height: 25, borderRadius: 9, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  timelineLine: { width: 1.5, flex: 1, backgroundColor: '#D9DADD' },
  eventCard: { flex: 1, backgroundColor: C.paper, borderRadius: 18, padding: 13, marginBottom: 12, borderWidth: 1, borderColor: '#EBEBE8' },
  eventCardOngoing: { borderColor: '#CFC7F3', backgroundColor: '#FDFCFF' },
  cardPressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  eventHeader: { flexDirection: 'row', alignItems: 'center' },
  eventIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  eventCopy: { flex: 1 },
  eventTitle: { color: C.ink, fontSize: 14, fontWeight: '700' },
  eventDetail: { color: C.muted, fontSize: 12, marginTop: 4, fontWeight: '500' },
  eventNote: { color: '#687382', fontSize: 11, lineHeight: 17, marginTop: 10, marginLeft: 49, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F0F0ED' },
  liveDot: { width: 8, height: 8, borderRadius: 4, marginRight: 3 },
  stopButton: { height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, marginTop: 12, marginLeft: 49 },
  stopButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  timelineEnd: { color: '#9DA3AC', textAlign: 'center', fontSize: 10, marginTop: 6 },
  quickAddWrap: { position: 'absolute', left: 14, right: 14, bottom: 66 },
  quickAddWrapElder: { bottom: 79 },
  quickAddBar: { height: 56, backgroundColor: 'rgba(255,255,255,0.98)', borderRadius: 18, paddingLeft: 6, paddingRight: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E8E8E5', shadowColor: '#293346', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 14, elevation: 7 },
  quickAddBarElder: { height: 66 },
  shortcut: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  shortcutText: { color: C.muted, fontSize: 11, fontWeight: '600' },
  fab: { width: 43, height: 43, borderRadius: 15, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  bottomTabs: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70, backgroundColor: C.paper, borderTopWidth: 1, borderTopColor: '#E7E7E4', flexDirection: 'row', paddingTop: 6, paddingBottom: 5 },
  bottomTabsElder: { height: 82, paddingTop: 8, paddingBottom: 7 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabIcon: { minWidth: 40, height: 27, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tabIconActive: { backgroundColor: '#EEF0F3' },
  tabLabel: { color: '#7E8792', fontSize: 11, fontWeight: '600' },
  tabLabelActive: { color: C.navy, fontWeight: '800' },
  toast: { position: 'absolute', bottom: 137, alignSelf: 'center', backgroundColor: '#29384D', borderRadius: 99, paddingVertical: 11, paddingHorizontal: 16, flexDirection: 'row', gap: 8, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, elevation: 8 },
  toastText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  emptyDay: { paddingTop: 75, alignItems: 'center' },
  emptyIllustration: { width: 78, height: 78, borderRadius: 28, backgroundColor: C.lavenderSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontSize: 19, color: C.ink, fontWeight: '800' },
  emptyText: { color: C.muted, textAlign: 'center', lineHeight: 21, fontSize: 13, width: 260, marginTop: 8 },
  primaryButton: { marginTop: 22, backgroundColor: C.navy, borderRadius: 15, paddingHorizontal: 18, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  pageTitle: { color: C.ink, fontSize: 27, fontWeight: '800' },
  pageSubtitle: { color: C.muted, fontSize: 14, marginTop: 5 },
  segmented: { flexDirection: 'row', backgroundColor: '#EBECE9', borderRadius: 14, padding: 4, marginBottom: 16 },
  segment: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: C.paper, shadowColor: '#26334A', shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },
  segmentText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: C.ink, fontWeight: '800' },
  chartCard: { backgroundColor: C.paper, borderRadius: 23, padding: 18, borderWidth: 1, borderColor: '#EAEAE7' },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chartLabel: { color: C.muted, fontSize: 13 },
  chartValue: { color: C.ink, fontSize: 23, fontWeight: '800', marginTop: 5 },
  trendBadge: { paddingHorizontal: 9, paddingVertical: 7, backgroundColor: C.sageSoft, borderRadius: 10, flexDirection: 'row', gap: 4, alignItems: 'center' },
  trendText: { color: C.sage, fontSize: 12, fontWeight: '800' },
  chart: { height: 172, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 24 },
  statsEmpty: { height: 172, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  statsEmptyTitle: { color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 10 },
  statsEmptyText: { color: C.muted, fontSize: 12, marginTop: 4 },
  barColumn: { flex: 1, alignItems: 'center', height: '100%' },
  barTrack: { flex: 1, width: 19, borderRadius: 8, backgroundColor: '#F0F1EF', justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 8 },
  barLabel: { color: '#7E8792', fontSize: 12, marginTop: 8 },
  listHeading: { color: C.ink, fontSize: 16, fontWeight: '800', marginTop: 24, marginBottom: 11 },
  insightCard: { flexDirection: 'row', backgroundColor: C.paper, borderRadius: 18, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#EBEBE8' },
  insightIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  insightCopy: { flex: 1 },
  insightTitle: { color: C.ink, fontSize: 15, fontWeight: '800', marginBottom: 5 },
  insightText: { color: C.muted, fontSize: 13, lineHeight: 20 },
  projectList: { backgroundColor: C.paper, borderRadius: 20, borderWidth: 1, borderColor: '#EAEAE7', overflow: 'hidden' },
  projectRow: { flexDirection: 'row', alignItems: 'center', padding: 13, minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E6E3' },
  projectIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  projectCopy: { flex: 1 },
  projectName: { color: C.ink, fontSize: 14, fontWeight: '700' },
  projectDescription: { color: C.muted, fontSize: 12, marginTop: 4 },
  fixedTag: { color: '#8E969F', fontSize: 11, backgroundColor: '#F1F2F0', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4 },
  customHeadingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  itemCount: { color: C.muted, fontSize: 11, marginBottom: 12 },
  addProjectButton: { marginTop: 11, backgroundColor: C.paper, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: '#EAEAE7', borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center' },
  addProjectIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.pinkSoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  addProjectTitle: { color: C.ink, fontSize: 15, fontWeight: '800' },
  addProjectText: { color: C.muted, fontSize: 12, marginTop: 4 },
  shortcutSettingsCard: { backgroundColor: C.paper, borderRadius: 20, borderWidth: 1, borderColor: '#E7E8E5', padding: 13, marginTop: 15 },
  shortcutSettingsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  shortcutSettingsTitle: { color: C.ink, fontSize: 15, fontWeight: '800' },
  shortcutSettingsHint: { color: C.muted, fontSize: 12, marginTop: 3 },
  shortcutSettingsCount: { color: C.navy, backgroundColor: '#EEF0F3', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 6, fontSize: 12, fontWeight: '800' },
  shortcutChoiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shortcutChoice: { width: '48.5%', minHeight: 43, borderRadius: 13, borderWidth: 1, borderColor: '#E0E2DF', backgroundColor: '#FAFAF8', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  shortcutChoiceText: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '700' },
  familyCard: { marginTop: 22, borderRadius: 20, backgroundColor: C.navy, padding: 18 },
  familyAvatars: { flexDirection: 'row', marginBottom: 12 },
  familyAvatar: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.navy },
  familyTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  familyText: { color: '#C4CCD7', fontSize: 13, marginTop: 5 },
  settingsSectionTitle: { color: C.ink, fontSize: 19, fontWeight: '800', marginTop: 22 },
  settingsSectionHint: { color: C.muted, fontSize: 13, marginTop: 4, marginBottom: -10 },
  accessibilityCard: { minHeight: 104, backgroundColor: C.paper, borderRadius: 20, borderWidth: 1, borderColor: '#E7E8E5', paddingHorizontal: 13, paddingVertical: 14, marginTop: 15, flexDirection: 'row', alignItems: 'center' },
  accessibilityCardActive: { borderColor: '#F2C8B5', backgroundColor: '#FFFCFA' },
  accessibilityCopy: { flex: 1, marginRight: 8 },
  accessibilityTitle: { color: C.ink, fontSize: 16, fontWeight: '800' },
  accessibilityText: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  fontPreviewRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 7 },
  fontPreviewSmall: { color: C.muted, fontSize: 11, fontWeight: '700' },
  fontPreviewLarge: { color: C.ink, fontSize: 17, fontWeight: '800' },
  accessibilityNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 5, marginTop: 9 },
  accessibilityNoteText: { flex: 1, color: '#668078', fontSize: 11, lineHeight: 17 },
  settingsList: { backgroundColor: C.paper, borderRadius: 20, borderWidth: 1, borderColor: '#E7E8E5', overflow: 'hidden', marginTop: 15 },
  settingsRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E2E3E0' },
  settingsRowIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  settingsRowCopy: { flex: 1 },
  settingsRowTitle: { color: C.ink, fontSize: 15, fontWeight: '700' },
  settingsRowSubtitle: { color: C.muted, fontSize: 12, marginTop: 3 },
  settingsRowValue: { color: C.muted, fontSize: 12, marginRight: 4 },
  dataPromiseCard: { marginTop: 11, backgroundColor: C.sageSoft, borderRadius: 17, padding: 14, flexDirection: 'row', alignItems: 'flex-start' },
  dataPromiseCopy: { flex: 1, marginLeft: 10 },
  dataPromiseTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  dataPromiseText: { color: '#5E776E', fontSize: 12, lineHeight: 18, marginTop: 3 },
  calendarPageHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 },
  monthNavigator: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  monthNavButton: { width: 29, height: 29, borderRadius: 10, backgroundColor: C.paper, borderWidth: 1, borderColor: '#E5E6E3', alignItems: 'center', justifyContent: 'center' },
  monthNavigatorText: { color: C.ink, fontSize: 13, fontWeight: '800' },
  monthCard: { backgroundColor: C.paper, borderRadius: 22, padding: 12, borderWidth: 1, borderColor: '#E7E8E5' },
  monthWeekRow: { flexDirection: 'row', marginBottom: 4 },
  monthWeekText: { flex: 1, textAlign: 'center', color: '#7F8791', fontSize: 11, fontWeight: '700' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthDayCell: { width: '14.285714%', height: 47, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 4 },
  monthDayNumberWrap: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  monthDayNumberActive: { backgroundColor: C.navy },
  monthDayNumber: { color: C.ink, fontSize: 14, fontWeight: '700' },
  monthDayNumberTextActive: { color: '#FFFFFF' },
  monthDots: { height: 6, flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  monthDot: { width: 4, height: 4, borderRadius: 2 },
  todayMiniLabel: { color: C.peach, fontSize: 9, fontWeight: '800', marginTop: -1 },
  calendarLegend: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingTop: 10, marginTop: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E4E5E2' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { color: C.muted, fontSize: 11 },
  selectedDayHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 19, marginBottom: 10 },
  selectedDayTitle: { color: C.ink, fontSize: 16, fontWeight: '800' },
  selectedDaySubtitle: { color: C.muted, fontSize: 12, marginTop: 3 },
  todayBadge: { backgroundColor: C.peachSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  todayBadgeText: { color: C.peach, fontSize: 11, fontWeight: '800' },
  calendarSummaryCard: { backgroundColor: C.paper, borderRadius: 19, padding: 14, borderWidth: 1, borderColor: '#E8E9E6' },
  calendarMetricsRow: { flexDirection: 'row' },
  calendarMetric: { flex: 1, alignItems: 'center' },
  calendarMetricIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  calendarMetricValue: { color: C.ink, fontSize: 12, fontWeight: '800' },
  calendarMetricLabel: { color: C.muted, fontSize: 11, marginTop: 2 },
  calendarSummaryDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E3E4E1', marginVertical: 13 },
  dayRhythmRow: { flexDirection: 'row', alignItems: 'center' },
  dayRhythmCopy: { flex: 1, marginLeft: 9 },
  dayRhythmTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  dayRhythmText: { color: C.muted, fontSize: 11, marginTop: 3 },
  rhythmScore: { backgroundColor: C.sageSoft, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 6 },
  rhythmScoreText: { color: C.sage, fontSize: 12, fontWeight: '800' },
  calendarEmptyCard: { backgroundColor: C.paper, borderRadius: 18, alignItems: 'center', padding: 19, borderWidth: 1, borderColor: '#E8E9E6' },
  calendarEmptyIcon: { width: 43, height: 43, borderRadius: 15, backgroundColor: '#F0F1EF', alignItems: 'center', justifyContent: 'center' },
  calendarEmptyTitle: { color: C.ink, fontSize: 13, fontWeight: '800', marginTop: 8 },
  calendarEmptyText: { color: C.muted, fontSize: 12, marginTop: 3 },
  openDayButton: { height: 49, borderRadius: 15, backgroundColor: C.navy, marginTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  openDayButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  calendarSyncCard: { marginTop: 12, backgroundColor: C.paper, borderRadius: 17, padding: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E8E9E6' },
  syncIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: C.sageSoft, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  syncCopy: { flex: 1 },
  syncTitle: { color: C.ink, fontSize: 11, fontWeight: '800' },
  syncText: { color: C.muted, fontSize: 8, marginTop: 3 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(27,35,47,0.42)' },
  sheet: { maxHeight: '88%', minHeight: 560, backgroundColor: C.canvas, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingBottom: 14, overflow: 'hidden' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#CCD0D3', alignSelf: 'center', marginTop: 9 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 13, paddingBottom: 16 },
  sheetHeaderButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sheetTitleWrap: { flex: 1, alignItems: 'center' },
  sheetTitle: { color: C.ink, fontSize: 18, fontWeight: '800' },
  sheetSubtitle: { color: C.muted, fontSize: 12, marginTop: 3 },
  kindGridWrap: { paddingHorizontal: 18, paddingBottom: 28 },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kindTile: { width: '48.5%', backgroundColor: C.paper, borderRadius: 19, padding: 15, borderWidth: 1, borderColor: '#EAEAE7', minHeight: 125 },
  kindIcon: { width: 47, height: 47, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  kindLabel: { color: C.ink, fontSize: 14, fontWeight: '800' },
  kindHint: { color: C.muted, fontSize: 12, marginTop: 4 },
  sheetSectionLabel: { color: C.ink, fontSize: 13, fontWeight: '800', marginTop: 22, marginBottom: 10 },
  customChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  customChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  customChipText: { fontSize: 12, fontWeight: '700' },
  customChipMode: { fontSize: 9, fontWeight: '700', opacity: 0.72 },
  form: { paddingHorizontal: 20, paddingBottom: 32 },
  formHeroIcon: { width: 55, height: 55, borderRadius: 19, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 15 },
  sleepStateCards: { gap: 8, marginBottom: 19 },
  sleepStateCard: { minHeight: 58, backgroundColor: C.paper, borderRadius: 15, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E0E2DF' },
  sleepStateCopy: { marginLeft: 10, flex: 1 },
  sleepStateTitle: { color: C.ink, fontSize: 13, fontWeight: '800' },
  sleepStateHint: { color: C.muted, fontSize: 12, marginTop: 3 },
  timeModeCards: { flexDirection: 'row', gap: 8 },
  timeModeCard: { flex: 1, minHeight: 66, backgroundColor: C.paper, borderRadius: 15, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E0E2DF' },
  modeSwitch: { flexDirection: 'row', backgroundColor: '#EAECEA', borderRadius: 14, padding: 4, marginBottom: 19 },
  modeActive: { flex: 1, backgroundColor: C.paper, height: 39, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeInactive: { flex: 1, height: 39, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeActiveText: { color: C.ink, fontSize: 12, fontWeight: '800' },
  modeInactiveText: { color: C.muted, fontSize: 12, fontWeight: '600' },
  field: { marginBottom: 18 },
  fieldLabel: { color: C.ink, fontSize: 14, fontWeight: '700', marginBottom: 9 },
  input: { height: 49, backgroundColor: C.paper, borderWidth: 1, borderColor: '#E0E2DF', borderRadius: 14, paddingHorizontal: 14, color: C.ink, fontSize: 14 },
  noteInput: { height: 74, textAlignVertical: 'top', paddingTop: 13 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceChip: { minHeight: 39, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#DCDEDC', backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  choiceText: { color: '#5F6976', fontSize: 14, fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 13 },
  amountButton: { width: 43, height: 43, borderRadius: 14, backgroundColor: C.paper, borderWidth: 1, borderColor: '#DFE1DE', alignItems: 'center', justifyContent: 'center' },
  amountInputWrap: { flexDirection: 'row', height: 62, minWidth: 138, borderRadius: 17, backgroundColor: C.paper, borderWidth: 1, borderColor: '#DFE1DE', alignItems: 'center', justifyContent: 'center' },
  amountInput: { color: C.ink, fontSize: 28, fontWeight: '800', minWidth: 65, textAlign: 'right', padding: 0 },
  amountUnit: { color: C.muted, fontSize: 13, marginLeft: 6, marginTop: 7 },
  presetRow: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 10 },
  preset: { backgroundColor: '#ECEDEB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  presetText: { color: C.muted, fontSize: 12, fontWeight: '600' },
  timePickerFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timePickerButton: { flex: 1, height: 51, backgroundColor: C.paper, borderWidth: 1, borderColor: '#E0E2DF', borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center' },
  timePickerValue: { color: C.ink, fontSize: 18, fontWeight: '800', marginLeft: 10 },
  timePickerHint: { color: '#858E99', fontSize: 11, marginLeft: 'auto', marginRight: 3 },
  timeNowButton: { width: 50, height: 51, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  timeNowText: { fontSize: 13, fontWeight: '800' },
  durationPreview: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 4 },
  durationPreviewText: { fontSize: 12, fontWeight: '700' },
  timeConflictNotice: { minHeight: 58, borderRadius: 14, borderWidth: 1, borderColor: '#F0CACA', backgroundColor: '#FFF2F2', padding: 11, marginBottom: 17, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  timeConflictCopy: { flex: 1 },
  timeConflictTitle: { color: '#A84848', fontSize: 13, fontWeight: '800' },
  timeConflictText: { color: '#A76767', fontSize: 11, lineHeight: 17, marginTop: 3 },
  timeInputRow: { height: 49, backgroundColor: C.paper, borderWidth: 1, borderColor: '#E0E2DF', borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  timeInput: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '700', marginLeft: 10 },
  nowButton: { fontSize: 12, fontWeight: '800', padding: 6 },
  saveButton: { height: 51, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 3 },
  saveButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  wheelModalRoot: { flex: 1, justifyContent: 'flex-end' },
  wheelBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(27,35,47,0.48)' },
  wheelSheet: { backgroundColor: C.canvas, borderTopLeftRadius: 27, borderTopRightRadius: 27, paddingBottom: 16, overflow: 'hidden' },
  wheelHeader: { height: 66, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#DCDDDA' },
  wheelHeaderTitleWrap: { alignItems: 'center' },
  wheelTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  wheelSelectedValue: { color: C.muted, fontSize: 12, marginTop: 3, fontWeight: '600' },
  wheelCancel: { color: C.muted, fontSize: 15, fontWeight: '600' },
  wheelDone: { fontSize: 15, fontWeight: '800' },
  wheelsWrap: { height: 210, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', position: 'relative', overflow: 'hidden' },
  wheelSelection: { position: 'absolute', left: 42, right: 42, top: 84, height: WHEEL_ITEM_HEIGHT, borderTopWidth: 1, borderBottomWidth: 1, borderRadius: 11 },
  wheelColumn: { width: 112, height: 210, zIndex: 2 },
  dateWheelColumn: { width: 108, height: 210, zIndex: 2 },
  wheelColumnContent: { paddingVertical: WHEEL_ITEM_HEIGHT * 2 },
  wheelItem: { height: WHEEL_ITEM_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  wheelItemText: { color: '#A4AAB2', fontSize: 21, fontWeight: '600', minWidth: 32, textAlign: 'right' },
  wheelItemTextSelected: { color: C.ink, fontSize: 25, fontWeight: '800' },
  wheelSuffix: { color: C.muted, fontSize: 12, marginLeft: 5, width: 18 },
  wheelColon: { color: C.ink, fontSize: 25, fontWeight: '800', zIndex: 3, width: 18, textAlign: 'center' },
  birthDateButton: { height: 51, backgroundColor: C.paper, borderWidth: 1, borderColor: '#E0E2DF', borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center' },
  birthDateValue: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '800', marginLeft: 10 },
  profileSheet: { minHeight: 520 },
  profileForm: { paddingHorizontal: 20, paddingBottom: 30 },
  profileAvatar: { width: 62, height: 62, borderRadius: 22, backgroundColor: C.peachSoft, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 20 },
  profileAvatarText: { color: C.peach, fontSize: 27, fontWeight: '800' },
  agePreview: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9, paddingLeft: 4 },
  agePreviewText: { color: C.sage, fontSize: 12, fontWeight: '700' },
  syncSheet: { minHeight: 430 },
  endpointInput: { fontSize: 13 },
  endpointHint: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 8, paddingHorizontal: 3 },
  passwordInputWrap: { height: 49, backgroundColor: C.paper, borderWidth: 1, borderColor: '#E0E2DF', borderRadius: 14, paddingLeft: 14, flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, color: C.ink, fontSize: 14 },
  passwordEyeButton: { width: 46, height: 47, alignItems: 'center', justifyContent: 'center' },
  managementSheet: { minHeight: 610, maxHeight: '92%' },
  managementForm: { paddingHorizontal: 20, paddingBottom: 30 },
  adminInfoCard: { backgroundColor: C.peachSoft, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  adminInfoText: { flex: 1, color: '#8D654F', fontSize: 12, lineHeight: 19 },
  managementLabel: { color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 20, marginBottom: 9 },
  managementList: { backgroundColor: C.paper, borderRadius: 18, borderWidth: 1, borderColor: '#E5E6E3', overflow: 'hidden' },
  managementRow: { minHeight: 70, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E1DE' },
  managementIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  managementCopy: { flex: 1 },
  managementNameInput: { color: C.ink, fontSize: 14, fontWeight: '800', paddingVertical: 2 },
  managementMeta: { color: C.muted, fontSize: 11, marginTop: 2 },
  currentRoleTag: { color: C.sage, backgroundColor: C.sageSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11, fontWeight: '800' },
  deleteRoleButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addRoleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addRoleButton: { width: 49, height: 49, borderRadius: 14, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center' },
  backupSheet: { minHeight: 570, maxHeight: '90%' },
  backupContent: { paddingHorizontal: 20, paddingBottom: 30 },
  backupPolicyCard: { backgroundColor: C.blueSoft, borderRadius: 17, padding: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  backupPolicyIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  backupPolicyCopy: { flex: 1 },
  backupPolicyTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  backupPolicyText: { color: '#60758C', fontSize: 12, lineHeight: 18, marginTop: 3 },
  backupHeadingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  backupCountText: { color: C.muted, fontSize: 12, marginBottom: 9 },
  backupRow: { minHeight: 68, backgroundColor: C.paper, borderRadius: 16, borderWidth: 1, borderColor: '#E5E6E3', paddingHorizontal: 11, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  backupDateBadge: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#F0F1EF', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  backupRowTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  backupRowText: { color: C.muted, fontSize: 10, marginTop: 3 },
  latestBackupTag: { color: C.blue, backgroundColor: C.blueSoft, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 4, fontSize: 10, fontWeight: '800', marginRight: 6 },
  backupEmpty: { minHeight: 120, backgroundColor: C.paper, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E6E3' },
  backupEmptyText: { color: C.muted, fontSize: 13, marginTop: 7 },
  projectSheet: { minHeight: 650, maxHeight: '94%' },
  projectForm: { paddingHorizontal: 20, paddingBottom: 30 },
  projectPreview: { width: 62, height: 62, borderRadius: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 20 },
  projectModeRow: { flexDirection: 'row', gap: 9 },
  projectModeCard: { flex: 1, minHeight: 84, borderRadius: 15, backgroundColor: C.paper, borderWidth: 1.5, borderColor: '#E0E2DF', padding: 11, justifyContent: 'center' },
  projectModeTitle: { color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 6 },
  projectModeHint: { color: C.muted, fontSize: 10, marginTop: 3 },
  projectIconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  projectIconChoice: { width: '23.4%', minHeight: 59, borderRadius: 13, backgroundColor: C.paper, borderWidth: 1.5, borderColor: '#E0E2DF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  projectIconLabel: { color: C.muted, fontSize: 10, fontWeight: '700', marginTop: 4 },
  colorRow: { flexDirection: 'row', gap: 12 },
  colorDotOuter: { width: 40, height: 40, borderRadius: 15, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  colorDot: { width: 27, height: 27, borderRadius: 11 },
  editSheet: { minHeight: 590, maxHeight: '90%' },
  editForm: { paddingHorizontal: 20, paddingBottom: 30 },
  editCategoryRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.paper, borderRadius: 15, padding: 11, marginBottom: 18, borderWidth: 1, borderColor: '#E9E9E6' },
  editCategoryIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  editCategoryLabel: { color: C.muted, fontSize: 11, marginBottom: 2 },
  editCategoryName: { fontSize: 13, fontWeight: '800' },
  finishSleepButton: { minHeight: 66, borderRadius: 17, paddingHorizontal: 15, marginBottom: 18, flexDirection: 'row', alignItems: 'center' },
  finishSleepPulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF', marginRight: 11 },
  finishSleepCopy: { flex: 1 },
  finishSleepTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  finishSleepHint: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 3 },
  editTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  editTimeInputWrap: { flex: 1, height: 49, backgroundColor: C.paper, borderWidth: 1, borderColor: '#E0E2DF', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  editTimeInput: { width: '100%', textAlign: 'center', color: C.ink, fontSize: 16, fontWeight: '700' },
  detailBody: { paddingHorizontal: 20, alignItems: 'center' },
  detailIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  detailTitle: { color: C.ink, fontSize: 20, fontWeight: '800', marginTop: 12 },
  detailValue: { color: C.muted, fontSize: 13, marginTop: 5 },
  detailMeta: { flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'center', gap: 22, marginTop: 18 },
  detailMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailMetaText: { color: C.muted, fontSize: 11 },
  detailNote: { alignSelf: 'stretch', backgroundColor: C.paper, borderRadius: 14, padding: 13, marginTop: 17 },
  detailNoteLabel: { color: C.muted, fontSize: 9, marginBottom: 4 },
  detailNoteText: { color: C.ink, fontSize: 12 },
  outlineButton: { alignSelf: 'stretch', height: 47, borderRadius: 14, borderWidth: 1.5, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  outlineButtonText: { fontSize: 13, fontWeight: '800' },
});
