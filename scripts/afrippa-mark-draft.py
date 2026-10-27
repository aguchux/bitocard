"""
Draft Afrippa marks from BitoCard's "b" (assets/logo.png), for the owner to choose from: the "b" mirrored so its
arrow points forward, its stem cut to the bowl's height and its pink cap moved down onto it, which makes a
single-storey "a". Draft A (mark-a-curved.png) keeps the b's rounded foot; draft B (mark-b-straight.png, made here)
runs the stem straight down to the baseline, as an "a" stands. Drafts only: the approved mark is redrawn as a vector.
Run from the repository root: python scripts/afrippa-mark-draft.py
"""
from PIL import Image
import numpy as np
S='assets/afrippa/drafts/'
src=np.array(Image.open('assets/logo.png').convert('RGBA'))
a=src.copy(); a[:,:,3]=np.where(a[:,:,3]<30,0,a[:,:,3])
solid=(a[:,:,3]>=250)&(a[:,:,2]>100)&(a[:,:,0]<60)
colour=np.array([0,43,134,255],dtype=a.dtype)
base=np.where(solid.any(axis=1))[0].max()
for y in range(700, base+1):
    xs=np.where(solid[y,270:700])[0]
    first=270+xs[0] if len(xs) else 502
    if first>282: a[y,282:min(first,502)]=colour
x0,x1=272,512; Y0=416; shift=Y0-250
cap=a[140:250, x0:x1].copy(); a[140:Y0, x0:x1]=0; a[140+shift:250+shift, x0:x1]=cap
a=a[:, ::-1]
ys,xs=np.where(a[:,:,3]>0); top,bottom,left,right=ys.min(),ys.max(),xs.min(),xs.max()
out=np.zeros_like(a); h=bottom-top+1; w=right-left+1; Y=(1254-h)//2; X=(1254-w)//2
out[Y:Y+h, X:X+w]=a[top:bottom+1, left:right+1]
Image.fromarray(out).save(S+'mark-b-straight.png')
A=Image.open(S+'mark-a-curved.png').convert('RGBA'); B=Image.fromarray(out)
sheet=Image.new('RGBA',(1254*2,1254),(255,255,255,255)); sheet.alpha_composite(A,(0,0)); sheet.alpha_composite(B,(1254,0))
sheet.convert('RGB').resize((1254,627)).save(S+'mark-options.png')
