"""Original deterministic electronic score. Python standard library only.
Usage: python3 scripts/score.py output.wav
Then: ffmpeg -i output.wav -af loudnorm=I=-17:TP=-1.5:LRA=8 -c:a libmp3lame -b:a 192k assets/score.mp3
No samples, recordings, model downloads or external libraries.
"""
import math,struct,wave,sys
RATE=32000
DURATION=48.5
notes=[130.8128,155.5635,195.9977,174.6141,130.8128,155.5635,233.0819,195.9977]
with wave.open(sys.argv[1],'wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(RATE)
    data=bytearray()
    for i in range(round(RATE*DURATION)):
        t=i/RATE
        beat=t%.5
        step=int(t/.25)
        pluck_t=t%.25
        note=notes[step%len(notes)]*2
        bass=.11*math.sin(2*math.pi*65.4064*t)*(.55+.45*math.exp(-beat*8))
        pulse=.09*(math.sin(2*math.pi*note*pluck_t)+.25*math.sin(2*math.pi*note*2*pluck_t))*math.exp(-pluck_t*18)
        kick=.18*math.sin(2*math.pi*(48*beat+28*(1-math.exp(-beat*35))/35))*math.exp(-beat*23)
        sh=(.018*math.sin(2*math.pi*7103*t)+.012*math.sin(2*math.pi*9971*t))*math.exp(-(t%.25)*65)
        section=t%7
        mark=.10*math.sin(2*math.pi*(74*section+24*(1-math.exp(-section*10))/10))*math.exp(-section*7)
        pad=.035*(math.sin(2*math.pi*130.8128*t)+math.sin(2*math.pi*155.5635*t)+math.sin(2*math.pi*195.9977*t))
        env=min(1,t/1.2,max(0,(DURATION-t)/2))
        left=(bass+kick+mark+pad+pulse+sh)*env
        right=(bass+kick+mark+pad+pulse*(.8+.2*math.sin(t*1.7))+sh*.7)*env
        data+=struct.pack('<hh',int(max(-.95,min(.95,left))*32767),int(max(-.95,min(.95,right))*32767))
        if len(data)>262144:w.writeframes(data);data.clear()
    w.writeframes(data)
