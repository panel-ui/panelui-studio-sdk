/**
 * The host app owns these, not us.
 *
 * Every one is an optional peer imported lazily inside a try/catch, so the
 * package must typecheck and publish without any of them installed. The call
 * sites cast to the small shape they actually use, which is the part we
 * depend on and the part worth checking.
 */
declare module "react-native"
declare module "expo-secure-store"
declare module "expo-constants"
declare module "expo-device"
declare module "expo-localization"
declare module "@react-native-async-storage/async-storage"
