import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Activity,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  Flame,
  ImagePlus,
  Leaf,
  Plus,
  Sparkles,
  Target,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const COLORS = {
  background: '#F5F4EF',
  card: '#FFFDF8',
  ink: '#1E2B23',
  muted: '#818A80',
  green: '#294C39',
  greenLight: '#E8EFE7',
  lime: '#D7ED91',
  border: '#E8E8E0',
  orange: '#F1A56F',
};

const DAILY_GOAL = 2000;
const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? '' : 'http://localhost:3000')
).replace(/\/+$/, '');
const MEALS_STORAGE_KEY = 'savor.meals.v1';

type Food = {
  name: string;
  portion: string;
  calories: number;
};

type Analysis = {
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foods: Food[];
};

type Meal = Analysis & {
  id: string;
  date: string;
  time: string;
  emoji: string;
};

type Tab = 'today' | 'log' | 'goals';

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isAnalysis(value: unknown): value is Analysis {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.mealName === 'string' &&
    Number.isSafeInteger(data.calories) &&
    typeof data.protein === 'number' && Number.isFinite(data.protein) && data.protein >= 0 &&
    typeof data.carbs === 'number' && Number.isFinite(data.carbs) && data.carbs >= 0 &&
    typeof data.fat === 'number' && Number.isFinite(data.fat) && data.fat >= 0 &&
    Array.isArray(data.foods) &&
    data.foods.every(
      (food) =>
        food &&
        typeof food.name === 'string' &&
        typeof food.portion === 'string' &&
        Number.isSafeInteger(food.calories) &&
        food.calories >= 0,
    )
  );
}

function isStoredMeal(value: unknown): value is Meal {
  if (!value || typeof value !== 'object') return false;
  const meal = value as Record<string, unknown>;
  return (
    isAnalysis(value) &&
    typeof meal.id === 'string' &&
    typeof meal.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(meal.date) &&
    typeof meal.time === 'string' &&
    typeof meal.emoji === 'string'
  );
}

async function analyzePhoto(asset: ImagePicker.ImagePickerAsset): Promise<Analysis> {
  const formData = new FormData();
  const fileName = asset.fileName ?? 'meal.jpg';

  if (Platform.OS === 'web') {
    const imageResponse = await fetch(asset.uri);
    if (!imageResponse.ok) throw new Error('Could not read the selected photo.');
    formData.append('photo', await imageResponse.blob(), fileName);
  } else {
    const imageFile = {
      uri: asset.uri,
      name: fileName,
      type: asset.mimeType ?? 'image/jpeg',
    } as Blob & { uri: string; name: string; type: string };
    formData.append('photo', imageFile, fileName);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/analyze`, {
      method: 'POST',
      body: formData,
    });
  } catch {
    throw new Error(
      'Can’t reach the AI server. Start it with “npm run server” and check EXPO_PUBLIC_API_URL in .env.',
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'The photo could not be analyzed. Please try again.';
    throw new Error(message);
  }
  if (!isAnalysis(payload)) {
    throw new Error('The AI server returned an unexpected result. Please try again.');
  }
  return payload;
}

function ProgressRing({ value, goal }: { value: number; goal: number }) {
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / goal, 1);

  return (
    <View style={styles.ringWrap}>
      <Svg width={116} height={116} viewBox="0 0 116 116">
        <Circle cx={58} cy={58} r={radius} fill="none" stroke="#48634F" strokeWidth={8} />
        <Circle
          cx={58}
          cy={58}
          r={radius}
          fill="none"
          stroke={COLORS.lime}
          strokeWidth={8}
          strokeDasharray={`${circumference * progress} ${circumference}`}
          strokeLinecap="round"
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={styles.ringValue}>{value.toLocaleString()}</Text>
        <Text style={styles.ringLabel}>kcal eaten</Text>
      </View>
    </View>
  );
}

function MacroCard({
  label,
  value,
  goal,
  color,
  unit = 'g',
}: {
  label: string;
  value: number;
  goal: number;
  color: string;
  unit?: string;
}) {
  return (
    <View style={styles.macroCard}>
      <View style={styles.macroTop}>
        <View style={[styles.macroDot, { backgroundColor: color }]} />
        <Text style={styles.macroLabel}>{label}</Text>
      </View>
      <Text style={styles.macroValue}>
        {value}
        <Text style={styles.macroGoal}> / {goal}{unit}</Text>
      </Text>
      <View style={styles.macroTrack}>
        <View
          style={[
            styles.macroFill,
            { backgroundColor: color, width: `${Math.min((value / goal) * 100, 100)}%` },
          ]}
        />
      </View>
    </View>
  );
}

function MealRow({ meal }: { meal: Meal }) {
  return (
    <View style={styles.mealRow}>
      <View style={styles.mealEmoji}>
        <Text style={styles.mealEmojiText}>{meal.emoji}</Text>
      </View>
      <View style={styles.mealCopy}>
        <Text style={styles.mealName} numberOfLines={1}>{meal.mealName}</Text>
        <View style={styles.mealTime}>
          <Clock3 size={12} color={COLORS.muted} />
          <Text style={styles.mealTimeText}>{meal.time}</Text>
        </View>
      </View>
      <Text style={styles.mealCalories}>{meal.calories} <Text style={styles.kcalSuffix}>kcal</Text></Text>
    </View>
  );
}

function SectionTitle({ children, action }: { children: string; action?: () => void }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action ? (
        <Pressable onPress={action} style={styles.seeAll}>
          <Text style={styles.seeAllText}>See all</Text>
          <ChevronRight size={15} color={COLORS.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function App() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageWritable, setStorageWritable] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(MEALS_STORAGE_KEY)
      .then((storedMeals) => {
        if (!active) return;
        if (storedMeals) {
          const parsed: unknown = JSON.parse(storedMeals);
          if (!Array.isArray(parsed) || !parsed.every(isStoredMeal)) {
            throw new Error('Saved meals did not match the expected format.');
          }
          setMeals(parsed);
        }
        setStorageWritable(true);
      })
      .catch((error: unknown) => {
        console.error('Could not load the saved meal journal:', error);
        if (active) {
          setStorageWarning('We couldn’t load your saved journal on this device.');
        }
      })
      .finally(() => {
        if (active) setStorageReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady || !storageWritable) return;
    AsyncStorage.setItem(MEALS_STORAGE_KEY, JSON.stringify(meals)).catch((error: unknown) => {
      console.error('Could not save the meal journal on this device:', error);
      setStorageWritable(false);
      setStorageWarning('Your latest change couldn’t be saved on this device.');
    });
  }, [meals, storageReady, storageWritable]);

  const todayKey = localDateKey(new Date());
  const todayMeals = useMemo(
    () => meals.filter((meal) => meal.date === todayKey),
    [meals, todayKey],
  );
  const mealDays = useMemo(() => {
    const days = new Map<string, Meal[]>();
    for (const meal of meals) {
      const day = days.get(meal.date);
      if (day) day.push(meal);
      else days.set(meal.date, [meal]);
    }
    return [...days.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [meals]);

  const totals = useMemo(
    () =>
      todayMeals.reduce(
        (result, meal) => ({
          calories: result.calories + meal.calories,
          protein: result.protein + meal.protein,
          carbs: result.carbs + meal.carbs,
          fat: result.fat + meal.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [todayMeals],
  );

  const remaining = Math.max(DAILY_GOAL - totals.calories, 0);

  const openPicker = () => {
    setSaved(false);
    setPickerVisible(true);
  };

  const choosePhoto = async (source: 'camera' | 'library') => {
    setPickerVisible(false);

    let result: ImagePicker.ImagePickerResult;
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          if (Platform.OS === 'web') {
            window.alert('Camera permission is needed to take a meal photo.');
          } else {
            Alert.alert('Camera access needed', 'Allow camera access in Settings to take a meal photo.');
          }
          return;
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.82,
        allowsEditing: false,
      };
      result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The photo picker could not be opened.';
      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Could not open photos', message);
      }
      return;
    }

    if (result.canceled || !result.assets[0]) return;

    setSelectedImage(result.assets[0].uri);
    setAnalysis(null);
    setScanError(null);
    setAnalysisVisible(true);
    setIsScanning(true);
    try {
      const asset = result.assets[0];
      const longestSide = Math.max(asset.width, asset.height);
      const size: { width: number | null; height: number | null } | undefined = longestSide > 1600
        ? asset.width >= asset.height
          ? { width: 1600, height: null }
          : { width: null, height: 1600 }
        : undefined;
      let imageContext = ImageManipulator.ImageManipulator.manipulate(asset.uri);
      if (size) imageContext = imageContext.resize(size);
      const renderedImage = await imageContext.renderAsync();
      const preparedImage = await renderedImage.saveAsync({
        format: ImageManipulator.SaveFormat.JPEG,
        compress: 0.82,
      });
      setSelectedImage(preparedImage.uri);
      setAnalysis(await analyzePhoto({
        ...asset,
        uri: preparedImage.uri,
        fileName: 'meal.jpg',
        mimeType: 'image/jpeg',
      }));
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Something went wrong while analyzing the photo.');
    } finally {
      setIsScanning(false);
    }
  };

  const saveMeal = () => {
    if (!analysis || saved) return;
    const now = new Date();
    setMeals((current) => [
      {
        ...analysis,
        id: `${Date.now()}`,
        date: localDateKey(now),
        time: new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(now),
        emoji: '🍽️',
      },
      ...current,
    ]);
    setSaved(true);
    setTab('today');
  };

  const closeAnalysis = () => {
    setAnalysisVisible(false);
    setSelectedImage(null);
    setAnalysis(null);
    setScanError(null);
    setSaved(false);
  };

  const renderToday = () => (
    <>
      <View style={styles.greeting}>
        <View>
          <Text style={styles.dateText}>{formatDate().toUpperCase()}</Text>
          <Text style={styles.greetingTitle}>A little better, <Text style={styles.greetingAccent}>every day.</Text></Text>
          <Text style={styles.greetingSub}>Here’s how you’re nourishing yourself.</Text>
        </View>
        <View style={styles.avatar}><Text style={styles.avatarText}>A</Text></View>
      </View>

      <LinearGradient colors={['#315A42', '#203D2E']} style={styles.calorieCard}>
        <View style={styles.calorieCardTop}>
          <View>
            <View style={styles.todayLabel}>
              <View style={styles.todayPulse} />
              <Text style={styles.todayLabelText}>TODAY’S INTAKE</Text>
            </View>
            <Text style={styles.remainingValue}>{remaining.toLocaleString()}</Text>
            <Text style={styles.remainingLabel}>calories left</Text>
          </View>
          <ProgressRing value={totals.calories} goal={DAILY_GOAL} />
        </View>
        <View style={styles.goalDivider} />
        <View style={styles.goalRow}>
          <View>
            <Text style={styles.goalCaption}>DAILY GOAL</Text>
            <Text style={styles.goalAmount}>{DAILY_GOAL.toLocaleString()} kcal</Text>
          </View>
          <View style={styles.goalBadge}>
            <Flame size={13} color={COLORS.lime} />
            <Text style={styles.goalBadgeText}>{Math.round((totals.calories / DAILY_GOAL) * 100)}% there</Text>
          </View>
        </View>
      </LinearGradient>

      <SectionTitle>Today’s balance</SectionTitle>
      <View style={styles.macrosRow}>
        <MacroCard label="Protein" value={totals.protein} goal={120} color="#7EBB86" />
        <MacroCard label="Carbs" value={totals.carbs} goal={220} color="#E9B077" />
        <MacroCard label="Fat" value={totals.fat} goal={70} color="#B2A0D4" />
      </View>

      <View style={styles.scanCard}>
        <View style={styles.scanCopy}>
          <View style={styles.aiPill}><Sparkles size={12} color={COLORS.green} /><Text style={styles.aiPillText}>AI-POWERED</Text></View>
          <Text style={styles.scanTitle}>What’s on your plate?</Text>
          <Text style={styles.scanSub}>Snap a photo. We’ll do the counting.</Text>
          <Pressable onPress={openPicker} style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}>
            <Camera size={17} color="#FFFFFF" />
            <Text style={styles.scanButtonText}>Scan a meal</Text>
            <ChevronRight size={16} color="#FFFFFF" />
          </Pressable>
        </View>
        <View style={styles.plateArt}>
          <View style={styles.plateOuter}><View style={styles.plateInner}><Text style={styles.plateEmoji}>🥙</Text></View></View>
          <View style={styles.sparkleOne}><Sparkles size={16} color="#B8D479" /></View>
          <View style={styles.sparkleTwo}><Leaf size={17} color="#D99D70" /></View>
        </View>
      </View>

      <SectionTitle action={() => setTab('log')}>Recent meals</SectionTitle>
      <View style={styles.mealsCard}>
        {todayMeals.slice(0, 3).map((meal, index) => (
          <View key={meal.id}>
            <MealRow meal={meal} />
            {index < Math.min(todayMeals.length, 3) - 1 ? <View style={styles.mealDivider} /> : null}
          </View>
        ))}
        {todayMeals.length === 0 ? <Text style={styles.emptyText}>Your meals will show up here after you scan them.</Text> : null}
      </View>
      <Text style={styles.disclaimer}>Estimates are a guide, not a substitute for professional nutrition advice.</Text>
    </>
  );

  const renderLog = () => (
    <>
      <View style={styles.pageHeading}>
        <Text style={styles.dateText}>YOUR FOOD JOURNAL</Text>
        <Text style={styles.pageTitle}>Meal history</Text>
        <Text style={styles.greetingSub}>Saved in this browser on this device. Not shared or synced.</Text>
      </View>
      <View style={styles.summaryStrip}>
        <View style={styles.summaryIcon}><Flame size={18} color={COLORS.green} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryTitle}>{totals.calories.toLocaleString()} calories</Text>
          <Text style={styles.summaryText}>of your {DAILY_GOAL.toLocaleString()} kcal daily goal</Text>
        </View>
        <Text style={styles.summaryPercent}>{Math.round((totals.calories / DAILY_GOAL) * 100)}%</Text>
      </View>
      {mealDays.map(([date, dayMeals]) => (
        <View key={date}>
          <SectionTitle>
            {date === todayKey ? 'Today' : formatDate(new Date(`${date}T12:00:00`))}
          </SectionTitle>
          <View style={styles.mealsCard}>
            {dayMeals.map((meal, index) => (
              <View key={meal.id}>
                <MealRow meal={meal} />
                {index < dayMeals.length - 1 ? <View style={styles.mealDivider} /> : null}
              </View>
            ))}
          </View>
        </View>
      ))}
      {meals.length === 0 ? (
        <View style={styles.mealsCard}>
          <Text style={styles.emptyText}>No meals logged yet. Scan a photo to get started.</Text>
        </View>
      ) : null}
      <Pressable onPress={openPicker} style={styles.outlineButton}>
        <Plus size={17} color={COLORS.green} />
        <Text style={styles.outlineButtonText}>Add a meal</Text>
      </Pressable>
    </>
  );

  const renderGoals = () => (
    <>
      <View style={styles.pageHeading}>
        <Text style={styles.dateText}>YOUR PERSONAL PLAN</Text>
        <Text style={styles.pageTitle}>Daily goals</Text>
        <Text style={styles.greetingSub}>Small, steady steps add up.</Text>
      </View>
      <View style={styles.goalDetailCard}>
        <View style={styles.goalDetailIcon}><Target size={21} color={COLORS.green} /></View>
        <Text style={styles.goalDetailEyebrow}>CALORIE TARGET</Text>
        <Text style={styles.goalDetailNumber}>{DAILY_GOAL.toLocaleString()}</Text>
        <Text style={styles.goalDetailUnit}>kcal per day</Text>
        <View style={styles.goalDetailRule} />
        <Text style={styles.goalDetailNote}>Your target is a starting point. Nutrition needs vary from person to person.</Text>
      </View>
      <SectionTitle>Macro targets</SectionTitle>
      <View style={styles.goalList}>
        {[
          { title: 'Protein', amount: '120 g', tint: '#EAF1E7', icon: '🥚' },
          { title: 'Carbohydrates', amount: '220 g', tint: '#F7EDE1', icon: '🌾' },
          { title: 'Healthy fats', amount: '70 g', tint: '#F0EBF7', icon: '🥑' },
        ].map((goal) => (
          <View style={styles.goalListRow} key={goal.title}>
            <View style={[styles.goalFoodIcon, { backgroundColor: goal.tint }]}><Text style={styles.goalFoodEmoji}>{goal.icon}</Text></View>
            <Text style={styles.goalListTitle}>{goal.title}</Text>
            <Text style={styles.goalListAmount}>{goal.amount}</Text>
          </View>
        ))}
      </View>
      <View style={styles.tipCard}>
        <Leaf size={18} color={COLORS.green} />
        <View style={styles.tipCopy}>
          <Text style={styles.tipTitle}>A gentle reminder</Text>
          <Text style={styles.tipText}>Progress isn’t perfection. Listen to your body and enjoy your food.</Text>
        </View>
      </View>
    </>
  );

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {storageWarning ? (
          <View style={styles.storageWarning}>
            <Text style={styles.storageWarningText}>{storageWarning}</Text>
          </View>
        ) : null}
        {tab === 'today' ? renderToday() : tab === 'log' ? renderLog() : renderGoals()}
      </ScrollView>
      <View style={styles.tabBar}>
        <View style={styles.tabBarInner}>
          {[
            { key: 'today' as const, label: 'Today', icon: Activity },
            { key: 'log' as const, label: 'Journal', icon: BookOpen },
            { key: 'goals' as const, label: 'My goals', icon: Target },
          ].map(({ key, label, icon: Icon }) => (
            <Pressable key={key} onPress={() => setTab(key)} style={styles.tabItem}>
              <Icon size={20} color={tab === key ? COLORS.green : '#9AA098'} strokeWidth={tab === key ? 2.4 : 1.8} />
              <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>{label}</Text>
              {tab === key ? <View style={styles.tabIndicator} /> : <View style={styles.tabIndicatorSpacer} />}
            </Pressable>
          ))}
        </View>
      </View>

      <Modal transparent animationType="slide" visible={pickerVisible} onRequestClose={() => setPickerVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeading}>
              <View>
                <Text style={styles.sheetEyebrow}>LET’S TAKE A LOOK</Text>
                <Text style={styles.sheetTitle}>Add your meal</Text>
              </View>
              <Pressable onPress={() => setPickerVisible(false)} style={styles.closeButton}><X size={20} color={COLORS.ink} /></Pressable>
            </View>
            <Text style={styles.sheetSub}>Choose a photo and AI will estimate the calories and macros.</Text>
            <Pressable onPress={() => choosePhoto('camera')} style={styles.sourceButton}>
              <View style={styles.sourceIcon}><Camera size={20} color={COLORS.green} /></View>
              <View style={{ flex: 1 }}><Text style={styles.sourceTitle}>Take a photo</Text><Text style={styles.sourceSub}>Use your camera</Text></View>
              <ChevronRight size={18} color={COLORS.muted} />
            </Pressable>
            <Pressable onPress={() => choosePhoto('library')} style={styles.sourceButton}>
              <View style={[styles.sourceIcon, styles.sourceIconWarm]}><ImagePlus size={20} color="#A86D43" /></View>
              <View style={{ flex: 1 }}><Text style={styles.sourceTitle}>Choose from library</Text><Text style={styles.sourceSub}>Pick a food photo</Text></View>
              <ChevronRight size={18} color={COLORS.muted} />
            </Pressable>
            <View style={styles.sheetPrivacy}>
              <Sparkles size={12} color={COLORS.muted} />
              <Text style={styles.sheetPrivacyText}>Your photo is sent to your AI server and isn’t added to your journal until you save it.</Text>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent animationType="fade" visible={analysisVisible} onRequestClose={closeAnalysis}>
        <View style={styles.resultBackdrop}>
          <View style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <View style={styles.resultHeaderBrand}>
                <View style={styles.resultBrandIcon}><Sparkles size={15} color={COLORS.green} /></View>
                <Text style={styles.resultHeaderLabel}>YOUR FOOD SCAN</Text>
              </View>
              <Pressable onPress={closeAnalysis} style={styles.closeButton}><X size={20} color={COLORS.ink} /></Pressable>
            </View>
            {selectedImage ? <Image source={{ uri: selectedImage }} style={styles.previewImage} resizeMode="cover" /> : null}
            {isScanning ? (
              <View style={styles.scanningState}>
                <ActivityIndicator size="small" color={COLORS.green} />
                <Text style={styles.scanningTitle}>Taking a closer look…</Text>
                <Text style={styles.scanningSub}>Identifying ingredients and estimating portions.</Text>
              </View>
            ) : scanError ? (
              <View style={styles.errorState}>
                <Text style={styles.errorTitle}>We couldn’t finish the scan</Text>
                <Text style={styles.errorText}>{scanError}</Text>
                <Pressable onPress={() => { closeAnalysis(); openPicker(); }} style={styles.retryButton}>
                  <Text style={styles.retryText}>Choose another photo</Text>
                </Pressable>
              </View>
            ) : analysis ? (
              <ScrollView style={styles.resultScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.resultMealHeading}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultEyebrow}>LOOKS DELICIOUS</Text>
                    <Text style={styles.resultMealName}>{analysis.mealName}</Text>
                  </View>
                  <View style={styles.resultCaloriePill}><Flame size={14} color="#A96036" /><Text style={styles.resultCalorieText}>{analysis.calories}</Text></View>
                </View>
                <View style={styles.resultMacroRow}>
                  <View style={styles.resultMacro}><Text style={styles.resultMacroAmount}>{analysis.protein}g</Text><Text style={styles.resultMacroLabel}>protein</Text></View>
                  <View style={styles.resultMacro}><Text style={styles.resultMacroAmount}>{analysis.carbs}g</Text><Text style={styles.resultMacroLabel}>carbs</Text></View>
                  <View style={styles.resultMacro}><Text style={styles.resultMacroAmount}>{analysis.fat}g</Text><Text style={styles.resultMacroLabel}>fat</Text></View>
                </View>
                <Text style={styles.detectedTitle}>What we spotted</Text>
                {analysis.foods.map((food, index) => (
                  <View style={styles.foodItem} key={`${food.name}-${index}`}>
                    <View style={styles.foodBullet} />
                    <Text style={styles.foodName}>{food.name}<Text style={styles.foodPortion}> · {food.portion}</Text></Text>
                    <Text style={styles.foodCalories}>{food.calories} kcal</Text>
                  </View>
                ))}
                <Text style={styles.estimateFootnote}>AI estimates can vary based on ingredients and portion size.</Text>
                <Pressable onPress={saveMeal} disabled={saved} style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saved && styles.savedButton]}>
                  {saved ? <Check size={18} color="#FFFFFF" /> : <Plus size={18} color="#FFFFFF" />}
                  <Text style={styles.saveButtonText}>{saved ? 'Added to today’s journal' : 'Add to my journal'}</Text>
                </Pressable>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 24, paddingBottom: 30 },
  storageWarning: { backgroundColor: '#F8EDE3', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, marginBottom: 14 },
  storageWarningText: { color: '#985D3A', fontSize: 11, lineHeight: 16 },
  greeting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  dateText: { color: '#889187', fontSize: 10, fontWeight: '700', letterSpacing: 1.35, marginBottom: 8 },
  greetingTitle: { color: COLORS.ink, fontSize: 25, lineHeight: 31, fontWeight: '600', letterSpacing: -0.7 },
  greetingAccent: { color: COLORS.green, fontStyle: 'italic' },
  greetingSub: { color: COLORS.muted, fontSize: 12, marginTop: 5, lineHeight: 18 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#E8EDE3', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D8E0D4' },
  avatarText: { color: COLORS.green, fontSize: 16, fontWeight: '700' },
  calorieCard: { borderRadius: 23, padding: 20, marginBottom: 24, overflow: 'hidden' },
  calorieCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  todayLabel: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 13 },
  todayPulse: { height: 6, width: 6, borderRadius: 3, backgroundColor: COLORS.lime },
  todayLabelText: { color: '#C9D6C7', fontSize: 9, letterSpacing: 1.2, fontWeight: '700' },
  remainingValue: { color: '#FFFFFF', fontSize: 35, lineHeight: 41, letterSpacing: -1.2, fontWeight: '600' },
  remainingLabel: { color: '#D2DCD0', fontSize: 12, marginTop: 1 },
  ringWrap: { width: 116, height: 116, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ringValue: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  ringLabel: { color: '#D2DCD0', fontSize: 8, marginTop: 1 },
  goalDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 17, marginBottom: 14 },
  goalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalCaption: { color: '#B7C7B7', fontSize: 8, fontWeight: '700', letterSpacing: 1.1, marginBottom: 4 },
  goalAmount: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  goalBadge: { backgroundColor: 'rgba(255,255,255,0.11)', borderRadius: 15, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 5 },
  goalBadgeText: { color: '#EFF5E7', fontSize: 10, fontWeight: '600' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  sectionTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '600', letterSpacing: -0.2, marginBottom: 11 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 1, marginBottom: 11 },
  seeAllText: { color: COLORS.muted, fontSize: 11 },
  macrosRow: { flexDirection: 'row', gap: 9, marginBottom: 22 },
  macroCard: { flex: 1, backgroundColor: COLORS.card, borderRadius: 15, paddingHorizontal: 11, paddingVertical: 13, borderWidth: 1, borderColor: '#EFEFE8' },
  macroTop: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 9 },
  macroDot: { width: 7, height: 7, borderRadius: 4 },
  macroLabel: { fontSize: 10, color: COLORS.muted, fontWeight: '500' },
  macroValue: { color: COLORS.ink, fontSize: 17, fontWeight: '700', letterSpacing: -0.5 },
  macroGoal: { color: '#9AA198', fontSize: 9, fontWeight: '400', letterSpacing: 0 },
  macroTrack: { height: 4, borderRadius: 2, backgroundColor: '#F0F0E9', marginTop: 10, overflow: 'hidden' },
  macroFill: { height: 4, borderRadius: 2 },
  scanCard: { minHeight: 190, backgroundColor: '#EDF1E8', borderRadius: 21, marginBottom: 23, padding: 18, overflow: 'hidden', flexDirection: 'row', alignItems: 'center' },
  scanCopy: { flex: 1, zIndex: 1 },
  aiPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: '#DDE8D7', borderRadius: 10, paddingVertical: 5, paddingHorizontal: 8, marginBottom: 10 },
  aiPillText: { color: COLORS.green, fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  scanTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '600', letterSpacing: -0.4 },
  scanSub: { color: COLORS.muted, fontSize: 10, marginTop: 5 },
  scanButton: { alignSelf: 'flex-start', marginTop: 14, backgroundColor: COLORS.green, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  scanButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  plateArt: { width: 100, height: 132, alignItems: 'center', justifyContent: 'center', marginRight: -9, marginLeft: -8 },
  plateOuter: { width: 91, height: 91, borderRadius: 46, backgroundColor: '#F8F8F3', borderWidth: 5, borderColor: '#DFE4D9', alignItems: 'center', justifyContent: 'center' },
  plateInner: { width: 66, height: 66, borderRadius: 34, backgroundColor: '#EEF0DF', alignItems: 'center', justifyContent: 'center' },
  plateEmoji: { fontSize: 35 },
  sparkleOne: { position: 'absolute', right: 4, top: 20 },
  sparkleTwo: { position: 'absolute', left: 5, bottom: 14 },
  mealsCard: { backgroundColor: COLORS.card, borderRadius: 17, borderWidth: 1, borderColor: '#EFEFE8', paddingHorizontal: 14, marginBottom: 12 },
  mealRow: { flexDirection: 'row', alignItems: 'center', minHeight: 68 },
  mealEmoji: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#F2F1E9', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  mealEmojiText: { fontSize: 21 },
  mealCopy: { flex: 1, minWidth: 0 },
  mealName: { color: COLORS.ink, fontSize: 11, fontWeight: '600', marginBottom: 5 },
  mealTime: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mealTimeText: { color: COLORS.muted, fontSize: 9 },
  mealCalories: { color: COLORS.ink, fontSize: 11, fontWeight: '700', marginLeft: 6 },
  kcalSuffix: { color: COLORS.muted, fontWeight: '400', fontSize: 9 },
  mealDivider: { height: 1, backgroundColor: '#F0F0EA', marginLeft: 53 },
  disclaimer: { textAlign: 'center', fontSize: 9, lineHeight: 14, color: '#9AA098', marginTop: 3, marginBottom: 4 },
  tabBar: { height: Platform.OS === 'ios' ? 79 : 65, backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: '#EAEAE3', paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 18 : 6 },
  tabBarInner: { width: '100%', maxWidth: 480, alignSelf: 'center', flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  tabItem: { alignItems: 'center', justifyContent: 'flex-start', gap: 4, minWidth: 66 },
  tabLabel: { fontSize: 9, color: '#9AA098', fontWeight: '500' },
  tabLabelActive: { color: COLORS.green, fontWeight: '700' },
  tabIndicator: { width: 14, height: 2, borderRadius: 1, backgroundColor: COLORS.green, marginTop: 1 },
  tabIndicatorSpacer: { width: 14, height: 2, marginTop: 1 },
  pageHeading: { paddingTop: 10, marginBottom: 23 },
  pageTitle: { color: COLORS.ink, fontSize: 29, fontWeight: '600', letterSpacing: -0.8 },
  summaryStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EAF0E7', padding: 15, borderRadius: 17, marginBottom: 24 },
  summaryIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#D9E6D5', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  summaryTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '700' },
  summaryText: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  summaryPercent: { color: COLORS.green, fontSize: 16, fontWeight: '700' },
  emptyText: { color: COLORS.muted, fontSize: 12, paddingVertical: 20, lineHeight: 18 },
  outlineButton: { borderWidth: 1, borderColor: '#CBD6C8', borderRadius: 13, minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 5 },
  outlineButtonText: { color: COLORS.green, fontSize: 12, fontWeight: '600' },
  goalDetailCard: { backgroundColor: COLORS.green, borderRadius: 22, padding: 21, alignItems: 'center', marginBottom: 25 },
  goalDetailIcon: { width: 43, height: 43, backgroundColor: '#D7ED91', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  goalDetailEyebrow: { color: '#B8C9B8', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  goalDetailNumber: { color: '#FFFFFF', fontSize: 43, fontWeight: '600', letterSpacing: -1.3, marginTop: 5 },
  goalDetailUnit: { color: '#D5DFD4', fontSize: 11 },
  goalDetailRule: { height: 1, width: '100%', backgroundColor: 'rgba(255,255,255,0.16)', marginVertical: 17 },
  goalDetailNote: { color: '#D5DFD4', textAlign: 'center', fontSize: 10, lineHeight: 16 },
  goalList: { backgroundColor: COLORS.card, borderRadius: 17, borderWidth: 1, borderColor: '#EFEFE8', paddingHorizontal: 14, marginBottom: 18 },
  goalListRow: { flexDirection: 'row', alignItems: 'center', minHeight: 62, borderBottomWidth: 1, borderBottomColor: '#F0F0EA' },
  goalFoodIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  goalFoodEmoji: { fontSize: 17 },
  goalListTitle: { flex: 1, color: COLORS.ink, fontSize: 12, fontWeight: '500' },
  goalListAmount: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
  tipCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#F0EEE4', borderRadius: 16, padding: 15, gap: 10 },
  tipCopy: { flex: 1 },
  tipTitle: { color: COLORS.ink, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  tipText: { color: COLORS.muted, fontSize: 10, lineHeight: 15 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(17, 29, 21, 0.38)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.card, borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingHorizontal: 22, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 34 : 23 },
  sheetHandle: { width: 37, height: 4, borderRadius: 2, backgroundColor: '#D9DCD4', alignSelf: 'center', marginBottom: 18 },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetEyebrow: { color: '#899288', fontSize: 9, letterSpacing: 1.2, fontWeight: '700', marginBottom: 5 },
  sheetTitle: { color: COLORS.ink, fontSize: 22, fontWeight: '600', letterSpacing: -0.5 },
  closeButton: { width: 35, height: 35, borderRadius: 18, backgroundColor: '#F1F1EB', alignItems: 'center', justifyContent: 'center' },
  sheetSub: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginTop: 8, marginBottom: 15 },
  sourceButton: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, marginBottom: 9, gap: 11 },
  sourceIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#EAF0E7', alignItems: 'center', justifyContent: 'center' },
  sourceIconWarm: { backgroundColor: '#F7EEE5' },
  sourceTitle: { color: COLORS.ink, fontSize: 12, fontWeight: '600' },
  sourceSub: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  sheetPrivacy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 8 },
  sheetPrivacyText: { color: COLORS.muted, fontSize: 9, lineHeight: 14, textAlign: 'center', flexShrink: 1 },
  resultBackdrop: { flex: 1, backgroundColor: 'rgba(17, 29, 21, 0.52)', justifyContent: 'center', alignItems: 'center', padding: 18 },
  resultCard: { width: '100%', maxWidth: 420, maxHeight: '90%', backgroundColor: COLORS.card, borderRadius: 23, padding: 17, overflow: 'hidden' },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  resultHeaderBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultBrandIcon: { width: 26, height: 26, borderRadius: 9, backgroundColor: '#E6EEE2', alignItems: 'center', justifyContent: 'center' },
  resultHeaderLabel: { color: '#828C81', fontSize: 9, letterSpacing: 1.1, fontWeight: '700' },
  previewImage: { width: '100%', height: 165, borderRadius: 15, backgroundColor: '#EFEFE9', marginBottom: 14 },
  scanningState: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  scanningTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '600', marginTop: 12 },
  scanningSub: { color: COLORS.muted, fontSize: 11, textAlign: 'center', marginTop: 5, lineHeight: 17 },
  errorState: { paddingVertical: 11 },
  errorTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '600' },
  errorText: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginTop: 7 },
  retryButton: { backgroundColor: '#EAF0E7', borderRadius: 11, alignItems: 'center', padding: 12, marginTop: 14 },
  retryText: { color: COLORS.green, fontSize: 11, fontWeight: '700' },
  resultScroll: { flexGrow: 0 },
  resultMealHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  resultEyebrow: { color: '#899288', fontSize: 8, fontWeight: '700', letterSpacing: 1.1, marginBottom: 4 },
  resultMealName: { color: COLORS.ink, fontSize: 18, fontWeight: '600', letterSpacing: -0.3 },
  resultCaloriePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F8EDE3', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12 },
  resultCalorieText: { color: '#985D3A', fontSize: 13, fontWeight: '700' },
  resultMacroRow: { flexDirection: 'row', backgroundColor: '#F3F4EE', borderRadius: 14, paddingVertical: 12, marginBottom: 16 },
  resultMacro: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#E4E7DF' },
  resultMacroAmount: { color: COLORS.ink, fontSize: 14, fontWeight: '700' },
  resultMacroLabel: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  detectedTitle: { color: COLORS.ink, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  foodItem: { flexDirection: 'row', alignItems: 'center', minHeight: 29 },
  foodBullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#82A47D', marginRight: 8 },
  foodName: { flex: 1, color: COLORS.ink, fontSize: 10 },
  foodPortion: { color: COLORS.muted },
  foodCalories: { color: COLORS.muted, fontSize: 9, marginLeft: 6 },
  estimateFootnote: { color: '#969D94', fontSize: 8, lineHeight: 12, marginTop: 9, marginBottom: 12 },
  saveButton: { backgroundColor: COLORS.green, borderRadius: 12, minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  savedButton: { backgroundColor: '#62806A' },
  saveButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
