import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native'

import { Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { usePalette } from '@/context/ThemeContext'

/** Venster midden op het scherm, zoals de modals op de site: tik naast het venster om te sluiten. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const p = usePalette()
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable
          accessibilityLabel="Sluiten"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: p.overlay, justifyContent: 'center', padding: 20 }}>
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: p.surface,
              borderColor: p.border,
              borderWidth: 1,
              borderRadius: Radius.lg,
              padding: 16,
              maxHeight: '80%',
            }}>
            <Txt variant="h2" style={{ marginBottom: 12 }}>{title}</Txt>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ gap: 12 }}>{children}</View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}
