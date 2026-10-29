import type { Ionicons } from '@expo/vector-icons';

export type ChargeType = 'water' | 'wifi' | 'trash' | 'electricity';

export const CHARGES: {
  key: ChargeType;
  label: string;
  unit: string;
  period: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'water', label: 'Water charge', unit: '₱', period: 'per bill', icon: 'water-outline' },
  { key: 'wifi', label: 'Wi-Fi charge', unit: '₱', period: 'per bill', icon: 'wifi-outline' },
  { key: 'trash', label: 'Trash charge', unit: '₱', period: 'per bill', icon: 'trash-outline' },
  {
    key: 'electricity',
    label: 'Electricity rate',
    unit: '₱/kWh',
    period: 'per kWh',
    icon: 'flash-outline',
  },
];

export function isChargeType(value: unknown): value is ChargeType {
  return value === 'water' || value === 'wifi' || value === 'trash' || value === 'electricity';
}
