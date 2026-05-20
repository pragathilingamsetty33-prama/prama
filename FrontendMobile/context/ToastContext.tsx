import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Bell } from 'lucide-react-native';

interface ToastData {
  title: string;
  text: string;
  chatId?: string;
}

interface ToastContextType {
  showToast: (title: string, text: string, chatId?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const activeChatId = params.id;

  const [toastVisible, setToastVisible] = useState(false);
  const [toastData, setToastData] = useState<ToastData>({ title: '', text: '' });
  
  // Safe off-screen ceiling initialization to avoid mount stutters or flashes
  const translateY = useSharedValue(-150);

  useEffect(() => {
    if (toastVisible) {
      // Dynamic hardware-accelerated transition using safe area inset calculations
      translateY.value = withTiming(insets.top + 10, { duration: 300 });
      
      const timer = setTimeout(() => {
        setToastVisible(false);
      }, 3500);

      return () => clearTimeout(timer);
    } else {
      translateY.value = withTiming(-150, { duration: 250 });
    }
  }, [toastVisible, insets.top]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const showToast = useCallback((title: string, text: string, chatId?: string) => {
    // 🚀 Strict optimization: Silence/suppress notification if currently in that active chat room!
    if (chatId && String(chatId) === String(activeChatId)) {
      return;
    }
    
    setToastData({ title, text, chatId });
    setToastVisible(true);
  }, [activeChatId]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toastVisible && (
        <Animated.View style={[styles.toastContainer, animatedStyle]}>
          <TouchableOpacity 
            activeOpacity={0.9} 
            onPress={() => setToastVisible(false)}
            style={styles.toastContent}
          >
            <View style={styles.toastIcon}>
              <Bell color="#0b0c10" size={18} />
            </View>
            <View style={styles.toastInfo}>
              <Text style={styles.toastTitle}>{toastData.title}</Text>
              <Text style={styles.toastText} numberOfLines={1}>{toastData.text}</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    left: 15,
    right: 15,
    backgroundColor: 'rgba(31, 40, 51, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(102, 252, 241, 0.2)',
    padding: 12,
    borderRadius: 12,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toastIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#66fcf1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toastInfo: {
    flex: 1,
  },
  toastTitle: {
    color: '#66fcf1',
    fontWeight: 'bold',
    fontSize: 14,
  },
  toastText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 2,
  },
});
