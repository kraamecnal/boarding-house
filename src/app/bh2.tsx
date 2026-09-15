import { StyleSheet, Text, View } from 'react-native';

export default function BH2Screen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>This is the BH2 Page!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
});