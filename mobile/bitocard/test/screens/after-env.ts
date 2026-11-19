import { configure } from '@testing-library/react-native';

// A busy machine (a build beside the tests) can be slow to settle a screen: give lookups time.
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30_000);
