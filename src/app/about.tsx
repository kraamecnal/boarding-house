import { ScrollView, StyleSheet, Text } from 'react-native';

export default function AboutScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>About InKeeper</Text>
      <Text style={styles.body}>
        InKeeper helps boarding-house owners organize their properties, keep tenant and room
        details together, and track upcoming and unpaid bills.
      </Text>
      <Text style={[styles.heading, styles.secondHeading]}>Made for everyday management</Text>
      <Text style={styles.body}>
        Use Boarding Houses to register properties and tenants, and Manage to review billing due
        dates and outstanding balances.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 32,
    backgroundColor: '#F8F9FA',
  },
  heading: {
    marginBottom: 10,
    color: '#1E293B',
    fontSize: 18,
    fontWeight: '700',
  },
  secondHeading: {
    marginTop: 36,
  },
  body: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 23,
  },
});
