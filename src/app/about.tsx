import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default function AboutScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>About InKeeper</Text>
        <Text style={styles.body}>
          InKeeper helps boarding-house owners organize their properties, keep tenant and room
          details together, and track upcoming and unpaid bills.
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>Made for everyday management</Text>
        <Text style={styles.body}>
          Use Boarding Houses to register properties and tenants, and Manage to review billing due
          dates and outstanding balances.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 18,
    backgroundColor: '#F8F9FA',
  },
  card: {
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  heading: {
    color: '#1E293B',
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 23,
  },
});
