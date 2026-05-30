import { supabase } from './supabase'

const BUCKET = 'sense-images'
const MAX_DIM = 800       // longest edge, px
const QUALITY = 0.82      // JPEG quality

// Downscale + compress an image File to a JPEG Blob (keeps storage small/fast).
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > height && width > MAX_DIM) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM }
      else if (height > MAX_DIM) { width = Math.round(width * MAX_DIM / height); height = MAX_DIM }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image compression failed')), 'image/jpeg', QUALITY)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')) }
    img.src = url
  })
}

// Parse the in-bucket path out of a public URL.
function pathFromUrl(url) {
  const marker = `/${BUCKET}/`
  const i = url.indexOf(marker)
  return i === -1 ? null : url.slice(i + marker.length)
}

// Upload an image for a sense; returns the public URL.
export async function uploadSenseImage(userId, senseId, file) {
  const blob = await compressImage(file)
  const path = `${userId}/${senseId}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// Remove a stored image by its public URL (best-effort).
export async function deleteSenseImageByUrl(url) {
  if (!url) return
  const path = pathFromUrl(url)
  if (path) await supabase.storage.from(BUCKET).remove([path])
}

// Persist the image_url on a sense row.
export async function setSenseImageUrl(senseId, userId, imageUrl) {
  await supabase.from('word_senses').update({ image_url: imageUrl }).eq('id', senseId).eq('user_id', userId)
}
